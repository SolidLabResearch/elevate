import "reflect-metadata";
import "./register-paths";
import { createServer } from "http";
import { config } from "./config";
import {
  corsHeaders,
  getRequestUrl,
  methodNotAllowed,
  notFound,
  readJson,
  sendJson,
  sendNoContent,
  sendRedirect,
  sendText
} from "./http";
import { finishAuthorization, startAuthorization } from "./auth";
import { AggregatorInstance } from "./types";
import { store } from "./store";
import { handleWebhook, stopAggregator, stopWebhookSubscriptions } from "./poller";
import { log } from "./log";
import {
  aggregatorDescriptionJson,
  clientIdDocument,
  listAggregators,
  provenanceTurtle,
  serverDescriptionJson,
  serviceCollectionTurtle,
  serviceDescriptionTurtle,
  serviceOutputUrl,
  transformationCatalogTurtle
} from "./metadata";
import {
  deleteAuthorizationServerClientRegistrations,
  deleteInstanceResourceRegistrations,
  deleteServiceResourceRegistrations,
  registerServiceResources
} from "./authorization-server";

interface RegistrationBody {
  management_flow?: string;
  issuer?: string;
  authorization_server?: string;
  code?: string;
  redirect_uri?: string;
  state?: string;
  source_container?: string;
  output_container?: string;
  athlete_settings?: string;
  user_settings?: string;
  return_url?: string;
  aggregator?: string;
}

export function createAggregatorServer() {
  return createServer(async (req, res) => {
    try {
      const url = getRequestUrl(req, config.baseUrl);
      const startedAt = Date.now();
      log.info("http request received", {
        method: req.method,
        path: url.pathname,
        query: summarizeSearchParams(url.searchParams)
      });
      res.on("finish", () => {
        log.info("http request completed", {
          method: req.method,
          path: url.pathname,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt
        });
      });

      if (req.method === "OPTIONS") {
        log.info("handling CORS preflight", { path: url.pathname });
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }

      if (url.pathname === "/" && req.method === "GET") {
        return sendJson(res, 200, serverDescriptionJson());
      }

      if (url.pathname === "/client.jsonld" && req.method === "GET") {
        return sendJson(res, 200, clientIdDocument(), {
          link: '<https://www.w3.org/ns/solid/oidc-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
        });
      }

      if (url.pathname === "/transformations" && req.method === "GET") {
        return sendText(res, 200, transformationCatalogTurtle(), "text/turtle");
      }

      if (url.pathname === "/login" && req.method === "GET") {
        const issuer = url.searchParams.get("issuer");
        if (!issuer) {
          log.warn("login request missing issuer");
          return sendJson(res, 400, { error: "issuer_required" });
        }
        log.info("starting login authorization", {
          issuer,
          hasAuthorizationServer: Boolean(url.searchParams.get("authorization_server")),
          hasSourceContainer: Boolean(url.searchParams.get("source_container")),
          hasOutputContainer: Boolean(url.searchParams.get("output_container")),
          hasReturnUrl: Boolean(url.searchParams.get("return_url"))
        });
        const started = await startAuthorization({
          issuer,
          authorizationServer: url.searchParams.get("authorization_server"),
          sourceContainer: url.searchParams.get("source_container"),
          outputContainer: url.searchParams.get("output_container"),
          athleteSettingsUrl: url.searchParams.get("athlete_settings"),
          userSettingsUrl: url.searchParams.get("user_settings"),
          returnUrl: url.searchParams.get("return_url")
        });
        return sendRedirect(res, started.authorizeUrl);
      }

      if (url.pathname === "/oidc/callback" && req.method === "GET") {
        const error = url.searchParams.get("error");
        if (error) {
          log.warn("OIDC callback returned an error", { error });
          return sendText(res, 400, `Solid authorization failed: ${error}`);
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        log.info("OIDC callback received", {
          hasCode: Boolean(code),
          hasState: Boolean(state)
        });
        if (!code || !state) {
          return sendText(res, 400, "Missing authorization code or state.");
        }
        const finished = await finishAuthorization(code, state);
        if (finished.returnUrl) {
          log.info("redirecting after aggregator creation", {
            aggregator: finished.instance.url,
            returnUrl: finished.returnUrl
          });
          const returnUrl = new URL(finished.returnUrl);
          returnUrl.searchParams.set("aggregator", finished.instance.url);
          returnUrl.searchParams.set("aggregator_status", "ready");
          return sendRedirect(res, returnUrl.toString());
        }
        return sendText(
          res,
          201,
          `<html><body><h1>Aggregator created</h1><p><a href="${finished.instance.url}">${finished.instance.url}</a></p><p>Watching ${finished.instance.sourceContainer} with Solid webhooks.</p></body></html>`,
          "text/html; charset=utf-8"
        );
      }

      if (url.pathname === "/registration") {
        if (req.method === "GET") {
          log.info("listing aggregator registrations", { count: store.instances.size });
          return sendJson(res, 200, listAggregators());
        }
        if (req.method === "POST") {
          return handleRegistrationPost(req, res);
        }
        if (req.method === "DELETE") {
          const body = await readJson<RegistrationBody>(req);
          const id = idFromAggregatorUrl(body.aggregator || "");
          if (!id || !store.instances.has(id)) {
            log.warn("delete registration requested for unknown aggregator", {
              aggregator: body.aggregator || null
            });
            return sendJson(res, 404, { error: "aggregator_not_found" });
          }
          log.info("deleting aggregator registration", { id, aggregator: body.aggregator });
          const instance = store.instances.get(id);
          if (instance) {
            await cleanupAggregatorInstance(instance);
          }
          return sendNoContent(res);
        }
        return methodNotAllowed(res, ["GET", "POST", "DELETE"]);
      }

      const instanceMatch = url.pathname.match(/^\/aggregators\/([^/]+)\/?(.*)$/u);
      if (instanceMatch) {
        const instance = store.instances.get(instanceMatch[1]);
        if (!instance) {
          return notFound(res);
        }
        const tail = instanceMatch[2] || "";

        if (tail === "" && req.method === "GET") {
          return sendJson(res, 200, aggregatorDescriptionJson(instance));
        }
        if (tail === "transformations" && req.method === "GET") {
          return sendText(res, 200, transformationCatalogTurtle(instance), "text/turtle");
        }
        if (tail === "services" && req.method === "HEAD") {
          res.writeHead(200, {
            "content-type": "text/turtle",
            etag: `"${instance.lastExecution?.endedAt || instance.createdAt}"`,
            "accept-post": "text/turtle",
            ...corsHeaders()
          });
          res.end();
          return;
        }
        if (tail === "services" && req.method === "GET") {
          return sendText(res, 200, serviceCollectionTurtle(instance), "text/turtle", {
            etag: `"${instance.lastExecution?.endedAt || instance.createdAt}"`,
            "accept-post": "text/turtle"
          });
        }
        if (tail === "services" && req.method === "POST") {
          log.info("creating service for aggregator instance", {
            id: instance.id,
            service: "fit-gpx-to-rdf"
          });
          await registerServiceResources(instance);
          return sendText(res, 201, serviceDescriptionTurtle(instance), "text/turtle", {
            location: `${instance.url}services/fit-gpx-to-rdf/`
          });
        }
        if (tail === "services/fit-gpx-to-rdf/" && req.method === "GET") {
          return sendText(res, 200, serviceDescriptionTurtle(instance), "text/turtle", {
            link: `<${instance.url}services/fit-gpx-to-rdf/>; rel="https://spec.knows.idlab.ugent.be/aggregator-protocol/latest/#fromService"`
          });
        }
        if (tail === "services/fit-gpx-to-rdf/" && req.method === "DELETE") {
          log.info("stopping service for aggregator instance", {
            id: instance.id,
            service: "fit-gpx-to-rdf"
          });
          await deleteServiceResourceRegistrations(instance);
          await stopWebhookSubscriptions(instance);
          stopAggregator(instance.id);
          return sendNoContent(res);
        }
        if (tail === "services/fit-gpx-to-rdf/output" && req.method === "GET") {
          return sendRedirect(res, serviceOutputUrl(instance), {
            link: `<${instance.url}services/fit-gpx-to-rdf/>; rel="https://spec.knows.idlab.ugent.be/aggregator-protocol/latest/#fromService"`
          });
        }
        if (tail === "services/fit-gpx-to-rdf/provenance" && req.method === "GET") {
          if (!instance.lastExecution) {
            return notFound(res);
          }
          return sendText(res, 200, provenanceTurtle(instance), "text/turtle");
        }
      }

      const webhookMatch = url.pathname.match(/^\/webhooks\/([^/]+)\/([^/]+)\/([^/]+)$/u);
      if (webhookMatch) {
        if (req.method !== "POST") {
          return methodNotAllowed(res, ["POST"]);
        }
        const instance = store.instances.get(webhookMatch[1]);
        if (!instance || webhookMatch[3] !== instance.webhookSecret) {
          log.warn("webhook received for unknown instance or invalid secret", {
            id: webhookMatch[1],
            kind: webhookMatch[2]
          });
          return notFound(res);
        }
        const kind = webhookMatch[2];
        if (kind !== "source" && kind !== "athlete-settings" && kind !== "user-settings") {
          return notFound(res);
        }
        const notification = await readJson(req);
        handleWebhook(instance, kind, notification);
        return sendNoContent(res);
      }

      return notFound(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("request failed", {
        message,
        stack: err instanceof Error ? err.stack : null
      });
      return sendJson(res, 500, { error: "internal_server_error", message });
    }
  });
}

if (require.main === module) {
  const server = createAggregatorServer();
  let shutdownStarted = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    log.info("server shutdown requested", { signal });
    try {
      await cleanupAllAggregatorInstances();
    } catch (err) {
      log.error("server shutdown cleanup failed", {
        signal,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : null
      });
    } finally {
      server.close(() => {
        process.exit(signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1);
      });
      setTimeout(() => process.exit(1), 5000).unref();
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  server.listen(config.port, config.host, () => {
    log.info("server listening", {
      baseUrl: config.baseUrl,
      host: config.host,
      port: config.port
    });
  });
}

export async function cleanupAllAggregatorInstances(): Promise<void> {
  const instances = Array.from(store.instances.values());
  log.info("cleaning up aggregator instances", { count: instances.length });
  await Promise.all(instances.map(instance => cleanupAggregatorInstance(instance)));
  await deleteAuthorizationServerClientRegistrations();
}

async function cleanupAggregatorInstance(instance: AggregatorInstance): Promise<void> {
  await deleteInstanceResourceRegistrations(instance);
  await stopWebhookSubscriptions(instance);
  store.instances.delete(instance.id);
  stopAggregator(instance.id);
}

async function handleRegistrationPost(req, res): Promise<void> {
  const body = await readJson<RegistrationBody>(req);
  log.info("registration POST received", summarizeRegistrationBody(body));
  if (body.management_flow !== "authorization_code") {
    log.warn("unsupported registration management flow", {
      managementFlow: body.management_flow || null
    });
    return sendJson(res, 400, { error: "unsupported_management_flow" });
  }

  if (body.code && body.state) {
    log.info("finishing authorization from registration POST", {
      hasCode: true,
      hasState: true
    });
    const { instance } = await finishAuthorization(body.code, body.state, body.redirect_uri);
    log.info("registration POST created aggregator", {
      id: instance.id,
      aggregator: instance.url
    });
    return sendJson(res, 201, { aggregator: instance.url });
  }

  if (!body.issuer) {
    log.warn("registration POST missing issuer");
    return sendJson(res, 400, { error: "issuer_required" });
  }

  const started = await startAuthorization({
    issuer: body.issuer,
    authorizationServer: body.authorization_server,
    sourceContainer: body.source_container,
    outputContainer: body.output_container,
    athleteSettingsUrl: body.athlete_settings,
    userSettingsUrl: body.user_settings,
    returnUrl: body.return_url
  });

  log.info("registration authorization started", {
    issuer: body.issuer,
    state: started.pending.state,
    redirectUri: started.pending.redirectUri
  });

  return sendJson(
    res,
    201,
    {
      aggregator_client_id: `${config.baseUrl}/client.jsonld`,
      code_challenge: started.pending.codeChallenge,
      code_challenge_method: "S256",
      state: started.pending.state,
      redirect_uri: started.pending.redirectUri,
      issuer: body.issuer,
      authorization_endpoint: started.authorizationEndpoint,
      authorization_url: started.authorizeUrl
    },
    { location: started.authorizeUrl }
  );
}

function summarizeSearchParams(params: URLSearchParams): Record<string, string> {
  const output: Record<string, string> = {};
  params.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function summarizeRegistrationBody(body: RegistrationBody): Record<string, unknown> {
  return {
    managementFlow: body.management_flow || null,
    issuer: body.issuer || null,
    hasAuthorizationServer: Boolean(body.authorization_server),
    hasCode: Boolean(body.code),
    hasState: Boolean(body.state),
    hasSourceContainer: Boolean(body.source_container),
    sourceContainer: body.source_container || null,
    hasOutputContainer: Boolean(body.output_container),
    outputContainer: body.output_container || null,
    hasAthleteSettings: Boolean(body.athlete_settings),
    hasUserSettings: Boolean(body.user_settings),
    hasReturnUrl: Boolean(body.return_url),
    aggregator: body.aggregator || null
  };
}

function idFromAggregatorUrl(aggregatorUrl: string): string | null {
  if (!aggregatorUrl) {
    return null;
  }
  try {
    const url = new URL(aggregatorUrl);
    const match = url.pathname.match(/\/aggregators\/([^/]+)\/?/u);
    return match?.[1] || null;
  } catch (_err) {
    return null;
  }
}
