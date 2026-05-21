import fetch from "cross-fetch";
import { config } from "./config";
import { AggregatorInstance, AggregatorResourceKind, AuthorizationServerClientCredentials } from "./types";
import { log } from "./log";
import { store } from "./store";

interface AuthorizationServerMetadata {
  issuer: string;
  jwks_uri: string;
  permission_endpoint: string;
  introspection_endpoint: string;
  resource_registration_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

interface PatToken {
  value: string;
  expiresAt: number | null;
}

interface ResourceDescription {
  name: string;
  resource_scopes: string[];
  type: string;
  description: string;
  icon_uri?: string;
  resource_defaults?: Record<string, string[]>;
  resource_relations?: Record<string, Record<string, string[]>>;
}

interface AggregatorResourceRegistration {
  kind: AggregatorResourceKind;
  uri: string;
  name: string;
  description: string;
  type: string;
  scopes: string[];
  container: boolean;
  parent: AggregatorResourceKind | null;
}

const READ_SCOPE = "urn:knows:uma:scopes:read";
const CREATE_SCOPE = "urn:knows:uma:scopes:create";
const DELETE_SCOPE = "urn:knows:uma:scopes:delete";
const LDP_CONTAINS = "http://www.w3.org/ns/ldp#contains";
const PAT_EXPIRY_SKEW_MS = 5000;

const metadataCache = new Map<string, Promise<AuthorizationServerMetadata>>();
const patCache = new Map<string, PatToken>();
const inProgressResources = new Map<string, Promise<string>>();

export async function registerInstanceResources(instance: AggregatorInstance): Promise<void> {
  for (const resource of instanceResourceRegistrations(instance)) {
    await registerResource(instance, resource);
  }
}

export async function registerServiceResources(instance: AggregatorInstance): Promise<void> {
  const resources = instanceResourceRegistrations(instance);
  await registerResource(
    instance,
    resources.find(resource => resource.kind === "service")
  );
  await registerResource(
    instance,
    resources.find(resource => resource.kind === "service-output")
  );
}

export async function deleteInstanceResourceRegistrations(instance: AggregatorInstance): Promise<void> {
  await deleteResourceRegistration(instance, "service-output");
  await deleteResourceRegistration(instance, "service");
  await deleteResourceRegistration(instance, "service-collection");
}

export async function deleteServiceResourceRegistrations(instance: AggregatorInstance): Promise<void> {
  await deleteResourceRegistration(instance, "service-output");
  await deleteResourceRegistration(instance, "service");
}

export async function deleteAuthorizationServerClientRegistrations(): Promise<void> {
  const entries = Array.from(store.authorizationServerClients.entries());
  for (const [cacheKey, credentials] of entries) {
    try {
      await deleteAuthorizationServerClientRegistration(cacheKey, credentials);
    } catch (err) {
      log.warn("authorization server client deletion failed during cleanup", {
        cacheKey,
        clientId: credentials.clientId,
        error: err instanceof Error ? err.message : String(err)
      });
      forgetAuthorizationServerClient(cacheKey, credentials);
    }
  }
}

async function registerResource(
  instance: AggregatorInstance,
  resource: AggregatorResourceRegistration | undefined
): Promise<string> {
  if (!resource) {
    throw new Error("Cannot register unknown aggregator resource.");
  }
  if (!instance.authorizationServer) {
    log.info("skipping UMA resource registration because no authorization server is configured", {
      id: instance.id,
      resource: resource.uri
    });
    return "";
  }

  const inProgressKey = `${instance.id}:${resource.kind}`;
  const inProgress = inProgressResources.get(inProgressKey);
  if (inProgress) {
    await inProgress;
    return registerResource(instance, resource);
  }

  const registration = registerResourceOnce(instance, resource).finally(() => {
    inProgressResources.delete(inProgressKey);
  });
  inProgressResources.set(inProgressKey, registration);
  return registration;
}

async function registerResourceOnce(
  instance: AggregatorInstance,
  resource: AggregatorResourceRegistration
): Promise<string> {
  if (resource.parent && !instance.resourceRegistrations[resource.parent]) {
    const parent = instanceResourceRegistrations(instance).find(item => item.kind === resource.parent);
    if (parent) {
      await registerResource(instance, parent);
    }
  }

  const metadata = await discoverAuthorizationServerMetadata(instance.authorizationServer);
  const pat = await getPat(instance, metadata);
  const knownUmaId = instance.resourceRegistrations[resource.kind];
  const url = knownUmaId
    ? `${metadata.resource_registration_endpoint.replace(/\/+$/u, "")}/${encodeURIComponent(knownUmaId)}`
    : metadata.resource_registration_endpoint;
  const response = await fetch(url, {
    method: knownUmaId ? "PUT" : "POST",
    headers: protectionApiHeaders(pat),
    body: JSON.stringify(resourceDescription(instance, resource))
  });
  const responseBody = await safeJson(response);
  const expectedStatus = knownUmaId ? 200 : 201;
  if (response.status !== expectedStatus) {
    log.warn("UMA resource registration failed", {
      id: instance.id,
      resource: resource.uri,
      method: knownUmaId ? "PUT" : "POST",
      registrationEndpoint: metadata.resource_registration_endpoint,
      status: response.status,
      body: responseBody
    });
    throw new Error(`UMA resource registration failed for ${resource.uri}: ${response.status}`);
  }

  const umaId = knownUmaId || responseUmaId(responseBody, response.headers.get("location"));
  if (!umaId) {
    throw new Error(`UMA resource registration response did not include an id for ${resource.uri}.`);
  }
  instance.resourceRegistrations[resource.kind] = umaId;
  log.info("UMA resource registered", {
    id: instance.id,
    resource: resource.uri,
    method: knownUmaId ? "PUT" : "POST",
    resourceRegistrationId: umaId,
    scopes: resource.scopes
  });
  return umaId;
}

async function deleteResourceRegistration(instance: AggregatorInstance, kind: AggregatorResourceKind): Promise<void> {
  if (!instance.authorizationServer) {
    return;
  }
  const umaId = instance.resourceRegistrations[kind];
  if (!umaId) {
    return;
  }

  const metadata = await discoverAuthorizationServerMetadata(instance.authorizationServer);
  const pat = await getPat(instance, metadata);
  const url = `${metadata.resource_registration_endpoint.replace(/\/+$/u, "")}/${encodeURIComponent(umaId)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: protectionApiHeaders(pat)
  });
  if (!response.ok && response.status !== 404) {
    const responseBody = await safeJson(response);
    log.warn("UMA resource registration deletion failed", {
      id: instance.id,
      kind,
      status: response.status,
      body: responseBody
    });
    throw new Error(`UMA resource registration deletion failed for ${kind}: ${response.status}`);
  }
  delete instance.resourceRegistrations[kind];
  log.info("UMA resource registration deleted", {
    id: instance.id,
    kind,
    resourceRegistrationId: umaId,
    status: response.status
  });
}

async function getPat(instance: AggregatorInstance, metadata: AuthorizationServerMetadata): Promise<string> {
  const credentials = await getClientCredentials(instance, metadata);
  const authorization = clientCredentialsAuthorization(credentials);
  const cacheKey = `${metadata.issuer} ${authorization}`;
  const cached = patCache.get(cacheKey);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
    return cached.value;
  }

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      authorization,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "uma_protection"
    }).toString()
  });
  const body = await safeJson(response);
  if (response.status !== 201) {
    log.warn("PAT request failed", {
      id: instance.id,
      authorizationServer: instance.authorizationServer,
      tokenEndpoint: metadata.token_endpoint,
      status: response.status,
      body
    });
    throw new Error(`PAT request failed: ${response.status}`);
  }
  if (!body || typeof body !== "object" || !("access_token" in body) || !("token_type" in body)) {
    throw new Error("PAT response did not include access_token and token_type.");
  }

  const tokenBody = body as { access_token: string; token_type: string; expires_in?: number };
  const expiresIn = typeof tokenBody.expires_in === "number" ? tokenBody.expires_in : null;
  const pat = `${tokenBody.token_type} ${tokenBody.access_token}`;
  patCache.set(cacheKey, {
    value: pat,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 - PAT_EXPIRY_SKEW_MS : null
  });
  log.info("PAT acquired for UMA protection API", {
    id: instance.id,
    authorizationServer: instance.authorizationServer,
    expiresIn
  });
  return pat;
}

async function getClientCredentials(
  instance: AggregatorInstance,
  metadata: AuthorizationServerMetadata
): Promise<AuthorizationServerClientCredentials> {
  if (instance.authorizationServerClient) {
    return instance.authorizationServerClient;
  }
  if (!instance.webId) {
    throw new Error("Cannot register aggregator as an authorization server client without a WebID.");
  }
  const cacheKey = clientCredentialsCacheKey(instance, metadata);
  const cachedCredentials = store.authorizationServerClients.get(cacheKey);
  if (cachedCredentials) {
    instance.authorizationServerClient = cachedCredentials;
    log.info("reusing cached authorization server client credentials", {
      id: instance.id,
      authorizationServer: instance.authorizationServer,
      webId: instance.webId,
      clientId: cachedCredentials.clientId
    });
    return cachedCredentials;
  }

  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: {
      authorization: `WebID ${encodeURIComponent(instance.webId)}`,
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      client_uri: config.baseUrl
    })
  });
  const body = await safeJson(response);
  if (response.status === 409) {
    log.warn("authorization server client is already registered but credentials are not cached", {
      id: instance.id,
      webId: instance.webId,
      registrationEndpoint: metadata.registration_endpoint,
      status: response.status,
      body
    });
    throw new Error(
      `Authorization server client already exists for ${config.baseUrl} and ${instance.webId}, but this aggregator process does not have its client_secret. Delete the stale AS client registration or restart from a process that created and cached it.`
    );
  }
  if (response.status !== 201) {
    log.warn("authorization server client registration failed", {
      id: instance.id,
      webId: instance.webId,
      registrationEndpoint: metadata.registration_endpoint,
      status: response.status,
      body
    });
    throw new Error(`Authorization server client registration failed: ${response.status}`);
  }
  if (!body || typeof body !== "object" || !("client_id" in body) || !("client_secret" in body)) {
    throw new Error("Authorization server client registration did not return client_id and client_secret.");
  }

  instance.authorizationServerClient = {
    clientId: String((body as { client_id: string }).client_id),
    clientSecret: String((body as { client_secret: string }).client_secret)
  };
  store.authorizationServerClients.set(cacheKey, instance.authorizationServerClient);
  log.info("registered aggregator as authorization server client", {
    id: instance.id,
    authorizationServer: instance.authorizationServer,
    clientId: instance.authorizationServerClient.clientId
  });
  return instance.authorizationServerClient;
}

function clientCredentialsCacheKey(instance: AggregatorInstance, metadata: AuthorizationServerMetadata): string {
  return `${metadata.issuer} ${instance.webId} ${config.baseUrl}`;
}

async function deleteAuthorizationServerClientRegistration(
  cacheKey: string,
  credentials: AuthorizationServerClientCredentials
): Promise<void> {
  const [issuer, webId] = cacheKey.split(" ");
  const metadata = await discoverAuthorizationServerMetadata(issuer);
  const response = await fetch(
    `${metadata.registration_endpoint.replace(/\/+$/u, "")}/${encodeURIComponent(credentials.clientId)}`,
    {
      method: "DELETE",
      headers: {
        authorization: clientCredentialsAuthorization(credentials),
        accept: "application/json"
      }
    }
  );
  if (!response.ok && response.status !== 404) {
    const body = await safeJson(response);
    log.warn("authorization server client deletion failed", {
      issuer,
      webId,
      clientId: credentials.clientId,
      registrationEndpoint: metadata.registration_endpoint,
      status: response.status,
      body
    });
    throw new Error(`Authorization server client deletion failed: ${response.status}`);
  }

  forgetAuthorizationServerClient(cacheKey, credentials, metadata.issuer);
  log.info("authorization server client deleted", {
    issuer,
    webId,
    clientId: credentials.clientId,
    status: response.status
  });
}

function forgetAuthorizationServerClient(
  cacheKey: string,
  credentials: AuthorizationServerClientCredentials,
  issuer?: string
): void {
  store.authorizationServerClients.delete(cacheKey);
  const authorization = clientCredentialsAuthorization(credentials);
  if (issuer) {
    patCache.delete(`${issuer} ${authorization}`);
    return;
  }
  for (const patKey of Array.from(patCache.keys())) {
    if (patKey.endsWith(` ${authorization}`)) {
      patCache.delete(patKey);
    }
  }
}

async function discoverAuthorizationServerMetadata(authorizationServer: string): Promise<AuthorizationServerMetadata> {
  const issuer = authorizationServer.replace(/\/+$/u, "");
  const metadataUrl = `${issuer}/.well-known/uma2-configuration`;
  const cached = metadataCache.get(metadataUrl);
  if (cached) {
    return cached;
  }

  const metadataPromise = fetch(metadataUrl, { headers: { accept: "application/json" } }).then(async response => {
    if (!response.ok) {
      throw new Error(`UMA discovery failed at ${metadataUrl}: ${response.status}`);
    }
    return validateAuthorizationServerMetadata(await response.json(), metadataUrl);
  });
  metadataCache.set(metadataUrl, metadataPromise);
  try {
    return await metadataPromise;
  } catch (err) {
    metadataCache.delete(metadataUrl);
    throw err;
  }
}

function validateAuthorizationServerMetadata(value: unknown, metadataUrl: string): AuthorizationServerMetadata {
  if (!value || typeof value !== "object") {
    throw new Error(`UMA discovery at ${metadataUrl} did not return an object.`);
  }
  const metadata = value as Record<string, unknown>;
  const required = [
    "issuer",
    "jwks_uri",
    "permission_endpoint",
    "introspection_endpoint",
    "resource_registration_endpoint",
    "token_endpoint",
    "registration_endpoint"
  ];
  for (const key of required) {
    if (typeof metadata[key] !== "string") {
      throw new Error(`UMA discovery at ${metadataUrl} is missing ${key}.`);
    }
  }
  return metadata as unknown as AuthorizationServerMetadata;
}

function resourceDescription(
  instance: AggregatorInstance,
  resource: AggregatorResourceRegistration
): ResourceDescription {
  const description: ResourceDescription = {
    name: resource.uri,
    resource_scopes: resource.scopes,
    type: resource.type,
    description: resource.description
  };
  if (resource.container) {
    description.resource_defaults = {
      [LDP_CONTAINS]: resource.scopes
    };
  }
  if (resource.parent) {
    const parentId = instance.resourceRegistrations[resource.parent];
    if (parentId) {
      description.resource_relations = {
        "@reverse": {
          [LDP_CONTAINS]: [parentId]
        }
      };
    }
  }
  return description;
}

function instanceResourceRegistrations(instance: AggregatorInstance): AggregatorResourceRegistration[] {
  const service = `${instance.url}services/fit-gpx-to-rdf/`;
  return [
    {
      kind: "service-collection",
      uri: `${instance.url}services`,
      name: "Elevate aggregator service collection",
      description: "Collection endpoint used to discover and create aggregator services.",
      type: "https://spec.knows.idlab.ugent.be/aggregator-protocol/latest/#ServiceCollection",
      scopes: [READ_SCOPE, CREATE_SCOPE],
      container: true,
      parent: null
    },
    {
      kind: "service",
      uri: service,
      name: "Elevate FIT/GPX/TCX to RDF service",
      description: "Aggregator service that converts Solid Pod activity files to Elevate activo RDF.",
      type: "https://spec.knows.idlab.ugent.be/aggregator-protocol/latest/#Service",
      scopes: [READ_SCOPE, DELETE_SCOPE],
      container: true,
      parent: "service-collection"
    },
    {
      kind: "service-output",
      uri: `${service}output`,
      name: "Elevate RDF activity output",
      description: "Derived RDF output endpoint produced by the Elevate aggregator service.",
      type: "http://www.w3.org/ns/dcat#Distribution",
      scopes: [READ_SCOPE],
      container: false,
      parent: "service"
    }
  ];
}

function protectionApiHeaders(pat: string): Headers {
  return new Headers({
    authorization: pat,
    accept: "application/json",
    "content-type": "application/json"
  });
}

function clientCredentialsAuthorization(credentials: AuthorizationServerClientCredentials): string {
  return `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64")}`;
}

function responseUmaId(body: unknown, location: string | null): string | null {
  if (body && typeof body === "object" && "_id" in body) {
    return String((body as { _id: string })._id);
  }
  if (!location) {
    return null;
  }
  return decodeURIComponent(location.replace(/\/+$/u, "").split("/").pop() || "");
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
}
