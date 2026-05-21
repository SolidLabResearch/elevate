import fetch from "cross-fetch";
import { Parser, Store } from "n3";
import { TokenSet } from "./types";
import { authenticatedFetch, getResourceAuthorizationHeader } from "./fetch";
import { AthleteModel } from "@elevate/shared/models/athlete/athlete.model";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";
import { parseAthleteModel, parseUserSettings, serializeAthleteModel, serializeUserSettings } from "./settings-rdf";
import { log } from "./log";

const LDP_CONTAINS = "http://www.w3.org/ns/ldp#contains";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#storage";
const SOLID_STORAGE_DESCRIPTION = "http://www.w3.org/ns/solid/terms#storageDescription";
const NOTIFY_SUBSCRIPTIONS = [
  "http://www.w3.org/ns/solid/notifications#subscription",
  "http://www.w3.org/ns/solid/notification#subscription"
];
const NOTIFY_CHANNEL_TYPES = [
  "http://www.w3.org/ns/solid/notifications#channelType",
  "http://www.w3.org/ns/solid/notification#channelType"
];
const WEBHOOK_CHANNEL_TYPES = new Set([
  "http://www.w3.org/ns/solid/notifications#WebhookChannel2023",
  "http://www.w3.org/ns/solid/notification#WebhookChannel2023",
  "WebhookChannel2023"
]);

export interface PodResource {
  iri: string;
  etag: string | null;
}

export interface WebhookChannel {
  id: string | null;
  sender: string | null;
}

export async function discoverStorageRoot(webId: string, tokenSet: TokenSet): Promise<string | null> {
  log.info("discovering Solid storage root", { webId });
  const authFetch = authenticatedFetch(tokenSet);
  const response = await authFetch(webId, { headers: { accept: "text/turtle, application/ld+json;q=0.8" } });
  if (!response.ok) {
    log.warn("could not fetch WebID profile for storage discovery", {
      webId,
      status: response.status
    });
    return null;
  }
  const body = await response.text();
  const store = parseTurtle(body, webId);
  const storage = store.getQuads(null, PIM_STORAGE, null, null)[0]?.object.value;
  log.info("Solid storage discovery completed", {
    webId,
    storageRoot: storage ? ensureTrailingSlash(storage) : null
  });
  return storage ? ensureTrailingSlash(storage) : null;
}

export async function listActivityFiles(tokenSet: TokenSet, containerUrl: string): Promise<PodResource[]> {
  log.info("listing activity container", { containerUrl });
  const authFetch = authenticatedFetch(tokenSet);
  const response = await authFetch(containerUrl, { headers: { accept: "text/turtle" } });
  if (!response.ok) {
    throw new Error(`Could not list ${containerUrl}: ${response.status}`);
  }
  const body = await response.text();
  const store = parseTurtle(body, containerUrl);
  const resources = store
    .getQuads(null, LDP_CONTAINS, null, null)
    .map(quad => quad.object.value)
    .filter(iri => /\.(fit|gpx|tcx)(\?.*)?$/iu.test(iri));
  log.info("activity container listed", {
    containerUrl,
    resourceCount: resources.length
  });

  return Promise.all(
    resources.map(async iri => {
      const head = await authFetch(iri, { method: "HEAD" });
      return {
        iri,
        etag: head.headers.get("etag") || head.headers.get("last-modified")
      };
    })
  );
}

export async function resourceSignature(tokenSet: TokenSet, resourceUrl: string): Promise<string | null> {
  const response = await authenticatedFetch(tokenSet)(resourceUrl, { method: "HEAD" });
  if (!response.ok) {
    log.warn("could not read resource signature", {
      resourceUrl,
      status: response.status
    });
    return null;
  }
  return response.headers.get("etag") || response.headers.get("last-modified");
}

export async function discoverWebhookSubscriptionResource(
  tokenSet: TokenSet,
  topicUrl: string
): Promise<string | null> {
  log.info("discovering webhook subscription resource", { topicUrl });
  const authFetch = authenticatedFetch(tokenSet);
  const head = await authFetch(topicUrl, { method: "HEAD" });
  log.info("topic HEAD for webhook discovery completed", {
    topicUrl,
    status: head.status,
    link: head.headers.get("link")
  });
  if (!head.ok) {
    log.warn("could not discover notifications for topic", {
      topicUrl,
      status: head.status
    });
    return null;
  }

  const storageDescriptionUrl = linkHeaderValue(head.headers.get("link"), SOLID_STORAGE_DESCRIPTION);
  if (!storageDescriptionUrl) {
    log.warn("topic did not advertise Solid storage description", { topicUrl });
    return null;
  }

  const storageDescription = new URL(storageDescriptionUrl, topicUrl).toString();
  log.info("fetching Solid storage description for webhook discovery", {
    topicUrl,
    storageDescription
  });
  const response = await authFetch(storageDescription, {
    headers: { accept: "text/turtle, application/ld+json;q=0.8" }
  });
  log.info("Solid storage description fetch completed", {
    topicUrl,
    storageDescription,
    status: response.status
  });
  if (!response.ok) {
    log.warn("could not fetch Solid storage description", {
      topicUrl,
      storageDescription,
      status: response.status
    });
    return null;
  }

  const body = await response.text();
  const store = parseTurtle(body, storageDescription);
  const candidates: Array<{ subscription: string; channelType: string | null }> = [];
  for (const subscriptionPredicate of NOTIFY_SUBSCRIPTIONS) {
    for (const subscription of store.getObjects(null, subscriptionPredicate, null)) {
      for (const channelTypePredicate of NOTIFY_CHANNEL_TYPES) {
        const channelType = store.getObjects(subscription, channelTypePredicate, null)[0]?.value;
        candidates.push({
          subscription: subscription.value,
          channelType: channelType || null
        });
        if (WEBHOOK_CHANNEL_TYPES.has(channelType)) {
          log.info("webhook subscription resource discovered", {
            topicUrl,
            subscriptionResource: subscription.value,
            channelType,
            candidates
          });
          return subscription.value;
        }
      }
    }
  }

  log.warn("Solid storage description did not advertise WebhookChannel2023", {
    topicUrl,
    storageDescription,
    candidates
  });
  return null;
}

export async function subscribeWebhook(
  tokenSet: TokenSet,
  topicUrl: string,
  sendTo: string
): Promise<WebhookChannel | null> {
  const subscriptionResource = await discoverWebhookSubscriptionResource(tokenSet, topicUrl);
  if (!subscriptionResource) {
    log.warn("webhook subscription resource unavailable", {
      topicUrl,
      sendTo
    });
    return null;
  }

  log.info("creating webhook subscription", {
    topicUrl,
    subscriptionResource,
    sendTo
  });
  const topicAuthorization = await getResourceAuthorizationHeader(tokenSet, topicUrl, {
    headers: { accept: "text/turtle, application/ld+json;q=0.8" }
  });
  const headers: Record<string, string> = {
    "content-type": "application/ld+json",
    accept: "application/ld+json"
  };
  if (topicAuthorization) {
    headers.authorization = topicAuthorization;
  }
  const response = await authenticatedFetch(tokenSet)(subscriptionResource, {
    method: "POST",
    headers,
    body: JSON.stringify({
      "@context": {
        notify: "http://www.w3.org/ns/solid/notifications#"
      },
      "@id": `${sendTo}#subscription`,
      "@type": "notify:WebhookChannel2023",
      "notify:topic": { "@id": topicUrl },
      "notify:sendTo": { "@id": sendTo },
      "notify:accept": "application/ld+json"
    })
  });
  const responseText = await response.text().catch(() => "");
  log.info("webhook subscription request completed", {
    topicUrl,
    subscriptionResource,
    sendTo,
    status: response.status,
    location: response.headers.get("location")
  });

  if (!response.ok) {
    log.warn("webhook subscription failed", {
      topicUrl,
      subscriptionResource,
      sendTo,
      status: response.status,
      body: responseText
    });
    return null;
  }

  const body = safeParseJson(responseText) as { id?: string; sender?: string };
  const channelId = body.id || absoluteHeaderUrl(response.headers.get("location"), subscriptionResource);
  log.info("webhook subscription created", {
    topicUrl,
    subscriptionResource,
    sendTo,
    channelId,
    sender: body.sender || null
  });
  return {
    id: channelId,
    sender: body.sender || null
  };
}

function safeParseJson(value: string): unknown {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch (_err) {
    return {};
  }
}

export async function unsubscribeWebhook(tokenSet: TokenSet, channelId: string): Promise<void> {
  const response = await authenticatedFetch(tokenSet)(channelId, { method: "DELETE" });
  log.info("webhook subscription delete requested", {
    channelId,
    status: response.status
  });
}

export async function fetchBinary(tokenSet: TokenSet, resourceUrl: string): Promise<Buffer> {
  log.info("fetching activity file", { resourceUrl });
  const response = await authenticatedFetch(tokenSet)(resourceUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch ${resourceUrl}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  log.info("activity file fetched", {
    resourceUrl,
    bytes: buffer.byteLength
  });
  return buffer;
}

export async function writeTurtle(tokenSet: TokenSet, resourceUrl: string, turtle: string): Promise<void> {
  log.info("writing Turtle resource", {
    resourceUrl,
    bytes: Buffer.byteLength(turtle)
  });
  const response = await authenticatedFetch(tokenSet)(resourceUrl, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: turtle
  });
  if (!response.ok) {
    throw new Error(`Could not write ${resourceUrl}: ${response.status} ${await response.text()}`);
  }
  log.info("Turtle resource written", {
    resourceUrl,
    status: response.status
  });
}

export async function readAthleteModel(tokenSet: TokenSet, url: string): Promise<AthleteModel> {
  log.info("reading athlete settings", { url });
  const response = await authenticatedFetch(tokenSet)(url, { headers: { accept: "text/turtle" } });
  if (!response.ok) {
    log.warn("athlete settings unavailable, using defaults", {
      url,
      status: response.status
    });
    return AthleteModel.DEFAULT_MODEL;
  }
  return parseAthleteModel(await response.text(), url);
}

export async function readUserSettings(tokenSet: TokenSet, url: string): Promise<UserSettings.BaseUserSettings> {
  log.info("reading user settings", { url });
  const response = await authenticatedFetch(tokenSet)(url, { headers: { accept: "text/turtle" } });
  if (!response.ok) {
    log.warn("user settings unavailable, using defaults", {
      url,
      status: response.status
    });
    return UserSettings.DesktopUserSettings.DEFAULT_MODEL;
  }
  return parseUserSettings(await response.text(), url);
}

export async function ensureDefaultPodSettings(
  tokenSet: TokenSet,
  athleteSettingsUrl: string,
  userSettingsUrl: string
): Promise<void> {
  log.info("ensuring default pod settings", {
    athleteSettingsUrl,
    userSettingsUrl
  });
  await ensureContainer(tokenSet, new URL(".", athleteSettingsUrl).toString());
  await putTurtleIfMissing(
    tokenSet,
    athleteSettingsUrl,
    serializeAthleteModel(athleteSettingsUrl, AthleteModel.DEFAULT_MODEL)
  );
  await putTurtleIfMissing(
    tokenSet,
    userSettingsUrl,
    serializeUserSettings(userSettingsUrl, UserSettings.DesktopUserSettings.DEFAULT_MODEL)
  );
}

export async function resourceExists(tokenSet: TokenSet, resourceUrl: string): Promise<boolean> {
  const response = await authenticatedFetch(tokenSet)(resourceUrl, { method: "HEAD" });
  log.info("checked pod resource existence", {
    resourceUrl,
    exists: response.ok,
    status: response.status
  });
  return response.ok;
}

async function putTurtleIfMissing(tokenSet: TokenSet, url: string, turtle: string): Promise<void> {
  const authFetch = authenticatedFetch(tokenSet);
  const existing = await authFetch(url, { method: "HEAD" });
  if (existing.ok) {
    log.info("default settings already exist", { url });
    return;
  }
  log.info("creating default settings resource", { url });
  const response = await authFetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: turtle
  });
  if (!response.ok) {
    throw new Error(`Could not create default settings ${url}: ${response.status} ${await response.text()}`);
  }
  log.info("default settings resource created", {
    url,
    status: response.status
  });
}

async function ensureContainer(tokenSet: TokenSet, containerUrl: string): Promise<void> {
  const authFetch = authenticatedFetch(tokenSet);
  log.info("ensuring pod container", { containerUrl });
  const head = await authFetch(containerUrl, { method: "HEAD" });
  if (head.ok) {
    log.info("pod container already exists", { containerUrl });
    return;
  }
  log.info("creating pod container", { containerUrl });
  const response = await authFetch(containerUrl, {
    method: "PUT",
    headers: {
      link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      "content-type": "text/turtle"
    }
  });
  log.info("pod container create request completed", {
    containerUrl,
    status: response.status
  });
}

function parseTurtle(turtle: string, baseIRI: string): Store {
  const parser = new Parser({ baseIRI });
  const store = new Store();
  store.addQuads(parser.parse(turtle));
  return store;
}

function linkHeaderValue(header: string | null, rel: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(/,(?=\s*<)/u)) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/iu);
    if (match && match[2] === rel) {
      return match[1];
    }
  }
  return null;
}

function absoluteHeaderUrl(value: string | null, baseUrl: string): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
