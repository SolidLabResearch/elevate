import fetch from "cross-fetch";
import { config } from "./config";
import { randomToken, sha256Base64Url, decodeJwtPayload, stableId } from "./crypto";
import { AggregatorInstance, PendingAuthorization, TokenSet } from "./types";
import { store } from "./store";
import { discoverStorageRoot, ensureDefaultPodSettings } from "./solid";
import { startAggregator } from "./poller";
import { authenticatedFetch } from "./fetch";
import { log } from "./log";
import { registerInstanceResources } from "./authorization-server";

interface OidcConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
}

interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const DEFAULT_SOURCE_CONTAINER_PATH = "raw-activities/";
const DEFAULT_OUTPUT_CONTAINER_PATH = "activities/";

export async function getOidcConfiguration(issuer: string): Promise<OidcConfiguration> {
  const cleanIssuer = issuer.replace(/\/+$/u, "");
  log.info("discovering OIDC configuration", { issuer: cleanIssuer });
  const response = await fetch(`${cleanIssuer}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`OIDC discovery failed for ${cleanIssuer}: ${response.status}`);
  }
  const configuration = (await response.json()) as OidcConfiguration;
  if (!configuration.authorization_endpoint || !configuration.token_endpoint) {
    throw new Error(`OIDC issuer ${cleanIssuer} is missing authorization_endpoint or token_endpoint.`);
  }
  log.info("OIDC configuration discovered", {
    issuer: cleanIssuer,
    authorizationEndpoint: configuration.authorization_endpoint,
    tokenEndpoint: configuration.token_endpoint
  });
  return configuration;
}

export async function startAuthorization(input: {
  issuer: string;
  authorizationServer?: string | null;
  sourceContainer?: string | null;
  outputContainer?: string | null;
  athleteSettingsUrl?: string | null;
  userSettingsUrl?: string | null;
  returnUrl?: string | null;
}): Promise<{ pending: PendingAuthorization; authorizationEndpoint: string; authorizeUrl: string }> {
  const issuer = input.issuer.trim().replace(/\/+$/u, "");
  log.info("starting authorization flow", {
    issuer,
    hasAuthorizationServer: Boolean(input.authorizationServer || config.defaultAuthorizationServer),
    hasSourceContainer: Boolean(input.sourceContainer),
    hasOutputContainer: Boolean(input.outputContainer),
    hasAthleteSettingsUrl: Boolean(input.athleteSettingsUrl),
    hasUserSettingsUrl: Boolean(input.userSettingsUrl),
    hasReturnUrl: Boolean(input.returnUrl)
  });
  const oidcConfiguration = await getOidcConfiguration(issuer);
  const state = randomToken(16);
  const codeVerifier = randomToken(64);
  const codeChallenge = sha256Base64Url(codeVerifier);
  const redirectUri = input.returnUrl || `${config.baseUrl}/oidc/callback`;

  const pending: PendingAuthorization = {
    state,
    issuer,
    authorizationServer: input.authorizationServer || config.defaultAuthorizationServer,
    codeVerifier,
    codeChallenge,
    redirectUri,
    sourceContainer: input.sourceContainer || null,
    outputContainer: input.outputContainer || null,
    athleteSettingsUrl: input.athleteSettingsUrl || null,
    userSettingsUrl: input.userSettingsUrl || null,
    returnUrl: input.returnUrl || null,
    createdAt: new Date().toISOString()
  };
  store.pending.set(state, pending);
  log.info("pending authorization stored", {
    state,
    issuer,
    redirectUri,
    clientId: `${config.baseUrl}/client.jsonld`
  });

  const authorizeUrl = new URL(oidcConfiguration.authorization_endpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", `${config.baseUrl}/client.jsonld`);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "openid webid offline_access");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("response_mode", "query");

  return {
    pending,
    authorizationEndpoint: oidcConfiguration.authorization_endpoint,
    authorizeUrl: authorizeUrl.toString()
  };
}

export async function finishAuthorization(
  code: string,
  state: string,
  redirectUri?: string | null
): Promise<{ instance: AggregatorInstance; returnUrl: string | null }> {
  log.info("finishing authorization", {
    hasCode: Boolean(code),
    state
  });
  const pending = store.pending.get(state);
  if (!pending) {
    throw new Error("Unknown or expired authorization state.");
  }
  if (redirectUri && redirectUri !== pending.redirectUri) {
    throw new Error("Authorization redirect_uri does not match the pending flow.");
  }

  const oidcConfiguration = await getOidcConfiguration(pending.issuer);
  log.info("exchanging authorization code for tokens", {
    issuer: pending.issuer,
    tokenEndpoint: oidcConfiguration.token_endpoint,
    redirectUri: pending.redirectUri
  });
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri || pending.redirectUri,
    client_id: `${config.baseUrl}/client.jsonld`,
    code_verifier: pending.codeVerifier
  }).toString();

  const response = await fetch(oidcConfiguration.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }
  const tokens = (await response.json()) as TokenResponse;
  if (!tokens.access_token) {
    throw new Error("Token exchange response did not include an access token.");
  }
  log.info("token exchange completed", {
    issuer: pending.issuer,
    hasAccessToken: Boolean(tokens.access_token),
    hasIdToken: Boolean(tokens.id_token),
    hasRefreshToken: Boolean(tokens.refresh_token),
    expiresIn: tokens.expires_in ?? null
  });

  const tokenSet: TokenSet = {
    accessToken: tokens.access_token,
    idToken: tokens.id_token || null,
    refreshToken: tokens.refresh_token || null,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null
  };
  const idPayload = tokenSet.idToken ? decodeJwtPayload(tokenSet.idToken) : null;
  const webId = idPayload?.webid || idPayload?.web_id || idPayload?.sub || null;
  log.info("resolved authorized WebID", {
    issuer: pending.issuer,
    webId
  });
  const storageRoot = webId ? await discoverStorageRoot(webId, tokenSet) : null;
  const authorizationServer = pending.authorizationServer;
  if (!authorizationServer) {
    throw new Error("Authorization server is required to create an aggregator.");
  }
  const defaultsBase = storageRoot || (webId ? new URL(webId).origin + "/" : config.baseUrl + "/");
  const requestedSourceContainer = pending.sourceContainer
    ? normalizeContainer(pending.sourceContainer)
    : new URL(DEFAULT_SOURCE_CONTAINER_PATH, defaultsBase).toString();
  const outputContainer = normalizeContainer(
    pending.outputContainer || new URL(DEFAULT_OUTPUT_CONTAINER_PATH, defaultsBase).toString()
  );
  const sourceContainer = normalizeLegacySourceContainer(requestedSourceContainer, outputContainer);
  const athleteSettingsUrl =
    pending.athleteSettingsUrl || new URL("settings/elevate-athlete.ttl", defaultsBase).toString();
  const userSettingsUrl = pending.userSettingsUrl || new URL("settings/elevate-user.ttl", defaultsBase).toString();
  log.info("resolved aggregator pod paths", {
    storageRoot,
    sourceContainer,
    outputContainer,
    athleteSettingsUrl,
    userSettingsUrl
  });

  await ensureDefaultPodSettings(tokenSet, athleteSettingsUrl, userSettingsUrl);

  const id = stableId(`${pending.issuer}:${webId || "unknown"}:${Date.now()}:${state}`);
  const instance: AggregatorInstance = {
    id,
    url: `${config.baseUrl}/aggregators/${id}/`,
    createdAt: new Date().toISOString(),
    issuer: pending.issuer,
    authorizationServer,
    authorizationServerClient: null,
    webId,
    storageRoot,
    sourceContainer,
    outputContainer,
    athleteSettingsUrl,
    userSettingsUrl,
    tokenSet,
    processedSources: {},
    settingsSignature: null,
    webhookSecret: randomToken(24),
    webhookSubscriptions: {},
    resourceRegistrations: {},
    lastExecution: null
  };

  await registerInstanceResources(instance);

  store.pending.delete(state);
  store.instances.set(id, instance);
  log.info("aggregator instance created", {
    id,
    url: instance.url,
    issuer: instance.issuer,
    webId: instance.webId,
    sourceContainer: instance.sourceContainer,
    outputContainer: instance.outputContainer
  });
  startAggregator(instance);
  return { instance, returnUrl: pending.returnUrl };
}

function normalizeContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function normalizeLegacySourceContainer(sourceContainer: string, outputContainer: string): string {
  if (sourceContainer !== outputContainer || !sourceContainer.endsWith(`/${DEFAULT_OUTPUT_CONTAINER_PATH}`)) {
    return sourceContainer;
  }

  const rawSourceContainer = sourceContainer.replace(
    new RegExp(`/${DEFAULT_OUTPUT_CONTAINER_PATH.replace("/", "\\/")}$`, "u"),
    `/${DEFAULT_SOURCE_CONTAINER_PATH}`
  );
  log.warn("rewriting legacy aggregator source container to raw activities", {
    requestedSourceContainer: sourceContainer,
    sourceContainer: rawSourceContainer,
    outputContainer
  });
  return rawSourceContainer;
}
