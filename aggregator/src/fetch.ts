import fetch from "cross-fetch";
import { TokenSet } from "./types";
import { log } from "./log";

interface UmaChallenge {
  asUri: string | null;
  ticket: string | null;
}

interface UmaMetadata {
  token_endpoint?: string;
  claim_token_formats_supported?: string[];
}

interface UmaTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface CachedUmaToken {
  accessToken: string;
  tokenType: string;
  expiresAt: number | null;
}

const ID_TOKEN_CLAIM_FORMAT = "http://openid.net/specs/openid-connect-core-1_0.html#IDToken";
const UMA_TOKEN_EXPIRY_SKEW_MS = 5000;

const umaTokenCache = new Map<string, CachedUmaToken>();
const umaMetadataCache = new Map<string, Promise<UmaMetadata>>();

export function authenticatedFetch(tokenSet: TokenSet): typeof globalThis.fetch {
  return (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const cacheKey = umaTokenCacheKey(url, init);
    const cachedToken = getCachedUmaToken(cacheKey);
    if (cachedToken) {
      const cachedHeaders = new Headers(init.headers || {});
      cachedHeaders.set("authorization", `${cachedToken.tokenType} ${cachedToken.accessToken}`);
      const cachedInit = { ...init, headers: cachedHeaders };
      const cachedRequest = describeRequest(url, cachedInit);
      log.info("pod request started with cached UMA RPT", {
        ...cachedRequest,
        cacheKey,
        expiresAt: cachedToken.expiresAt ? new Date(cachedToken.expiresAt).toISOString() : null
      });
      const cachedResponse = await fetch(url as any, cachedInit as any);
      log.info("pod request with cached UMA RPT completed", {
        ...cachedRequest,
        cacheKey,
        status: cachedResponse.status
      });
      if (cachedResponse.status !== 401) {
        return cachedResponse as any;
      }
      umaTokenCache.delete(cacheKey);
      log.warn("evicted cached UMA RPT after 401", {
        ...cachedRequest,
        cacheKey
      });
    }

    const initialHeaders = new Headers(init.headers || {});
    if (!initialHeaders.has("authorization") && tokenSet.accessToken) {
      initialHeaders.set("authorization", `Bearer ${tokenSet.accessToken}`);
    }
    const authenticatedInit = { ...init, headers: initialHeaders };
    const request = describeRequest(url, authenticatedInit);
    log.info("pod request started", request);
    const initialResponse = await fetch(url as any, authenticatedInit as any);
    log.info("pod request completed", {
      ...request,
      status: initialResponse.status
    });
    if (initialResponse.ok || initialResponse.status !== 401) {
      return initialResponse as any;
    }

    const challenge = parseUmaChallenge(initialResponse.headers.get("www-authenticate"));
    logAuth("401 received from pod resource", {
      ...request,
      status: initialResponse.status,
      hasAccessToken: Boolean(tokenSet.accessToken),
      hasIdToken: Boolean(tokenSet.idToken),
      umaChallenge: challenge
        ? {
            asUri: challenge.asUri,
            hasTicket: Boolean(challenge.ticket)
          }
        : null
    });

    if (challenge?.asUri && challenge.ticket && tokenSet.idToken) {
      const rpt = await requestUmaToken(challenge, tokenSet.idToken, request);
      if (rpt.access_token && rpt.token_type) {
        setCachedUmaToken(cacheKey, rpt, request);
        const rptHeaders = new Headers(init.headers || {});
        rptHeaders.set("authorization", `${rpt.token_type} ${rpt.access_token}`);
        logAuth("retrying pod resource with UMA RPT", {
          ...request,
          rptTokenType: rpt.token_type,
          rptExpiresIn: rpt.expires_in ?? null
        });
        const rptResponse = await fetch(url as any, { ...init, headers: rptHeaders } as any);
        log.info("pod request with UMA RPT completed", {
          ...request,
          status: rptResponse.status
        });
        return rptResponse as any;
      }
      logAuth("UMA token response did not include a usable RPT", {
        ...request,
        hasRptAccessToken: Boolean(rpt.access_token),
        rptTokenType: rpt.token_type ?? null
      });
    }

    logAuth("pod resource remains unauthorized after OIDC access token", {
      ...request,
      hasAccessToken: Boolean(tokenSet.accessToken),
      reason:
        challenge?.asUri && challenge.ticket ? "uma_not_available_or_missing_id_token" : "no_complete_uma_challenge"
    });
    return initialResponse as any;
  }) as typeof globalThis.fetch;
}

export async function getResourceAuthorizationHeader(
  tokenSet: TokenSet,
  url: RequestInfo | URL,
  init: RequestInit = {}
): Promise<string | null> {
  const cacheKey = umaTokenCacheKey(url, init);
  const cachedToken = getCachedUmaToken(cacheKey);
  if (cachedToken) {
    return `${cachedToken.tokenType} ${cachedToken.accessToken}`;
  }

  const headers = new Headers(init.headers || {});
  if (!headers.has("authorization") && tokenSet.accessToken) {
    headers.set("authorization", `Bearer ${tokenSet.accessToken}`);
  }
  const authenticatedInit = { ...init, headers };
  const request = describeRequest(url, authenticatedInit);
  const response = await fetch(url as any, authenticatedInit as any);
  if (response.ok) {
    return headers.get("authorization");
  }
  if (response.status !== 401) {
    return headers.get("authorization");
  }

  const challenge = parseUmaChallenge(response.headers.get("www-authenticate"));
  logAuth("401 received while probing resource authorization", {
    ...request,
    status: response.status,
    hasAccessToken: Boolean(tokenSet.accessToken),
    hasIdToken: Boolean(tokenSet.idToken),
    umaChallenge: challenge
      ? {
          asUri: challenge.asUri,
          hasTicket: Boolean(challenge.ticket)
        }
      : null
  });
  if (!challenge?.asUri || !challenge.ticket || !tokenSet.idToken) {
    return headers.get("authorization");
  }

  const rpt = await requestUmaToken(challenge, tokenSet.idToken, request);
  setCachedUmaToken(cacheKey, rpt, request);
  if (!rpt.access_token || !rpt.token_type) {
    return headers.get("authorization");
  }
  return `${rpt.token_type} ${rpt.access_token}`;
}

function parseUmaChallenge(header: string | null): UmaChallenge | null {
  if (!header || !header.toLowerCase().includes("uma")) {
    return null;
  }

  const params: Record<string, string> = {};
  const regex = /(\w+)=("[^"]*"|[^\s,]+)/gu;
  let match = regex.exec(header);
  while (match) {
    params[match[1]] = match[2].startsWith('"') ? match[2].slice(1, -1) : match[2];
    match = regex.exec(header);
  }

  return {
    asUri: params.as_uri || null,
    ticket: params.ticket || null
  };
}

async function requestUmaToken(
  challenge: UmaChallenge,
  idToken: string,
  originalRequest: Record<string, unknown>
): Promise<UmaTokenResponse> {
  const metadataUrl = umaMetadataUrl(challenge.asUri);
  logAuth("discovering UMA metadata", {
    ...originalRequest,
    asUri: challenge.asUri,
    metadataUrl
  });

  const metadata = await discoverUmaMetadata(challenge.asUri);
  if (!metadata.token_endpoint) {
    throw new Error(`UMA metadata at ${challenge.asUri} does not include token_endpoint.`);
  }

  logAuth("requesting UMA RPT", {
    ...originalRequest,
    tokenEndpoint: metadata.token_endpoint,
    claimTokenFormat: ID_TOKEN_CLAIM_FORMAT,
    supportedClaimTokenFormats: metadata.claim_token_formats_supported ?? null,
    hasTicket: Boolean(challenge.ticket),
    hasClaimToken: Boolean(idToken)
  });

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:uma-ticket",
      ticket: challenge.ticket,
      claim_token: idToken,
      claim_token_format: ID_TOKEN_CLAIM_FORMAT
    })
  });

  const body = await safeJson(response);
  if (!response.ok) {
    logAuth("UMA token request failed", {
      ...originalRequest,
      status: response.status,
      tokenEndpoint: metadata.token_endpoint,
      claimTokenFormat: ID_TOKEN_CLAIM_FORMAT,
      body
    });
    throw new Error(`UMA token request failed (${response.status}): ${JSON.stringify(body)}`);
  }
  logAuth("UMA token request succeeded", {
    ...originalRequest,
    status: response.status,
    tokenEndpoint: metadata.token_endpoint,
    tokenType: body && typeof body === "object" && "token_type" in body ? (body as UmaTokenResponse).token_type : null,
    expiresIn: body && typeof body === "object" && "expires_in" in body ? (body as UmaTokenResponse).expires_in : null
  });
  return body as UmaTokenResponse;
}

async function discoverUmaMetadata(asUri: string): Promise<UmaMetadata> {
  const metadataUrl = umaMetadataUrl(asUri);
  const cached = umaMetadataCache.get(metadataUrl);
  if (cached) {
    log.info("using cached UMA metadata", { metadataUrl });
    return cached;
  }

  const metadataPromise = fetchUmaMetadata(metadataUrl);
  umaMetadataCache.set(metadataUrl, metadataPromise);
  try {
    return await metadataPromise;
  } catch (err) {
    umaMetadataCache.delete(metadataUrl);
    throw err;
  }
}

async function fetchUmaMetadata(metadataUrl: string): Promise<UmaMetadata> {
  const response = await fetch(metadataUrl, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`UMA metadata discovery failed at ${metadataUrl}: ${response.status}`);
  }
  return (await response.json()) as UmaMetadata;
}

function umaMetadataUrl(asUri: string): string {
  return asUri.includes("/.well-known/") ? asUri : `${asUri.replace(/\/+$/u, "")}/.well-known/uma2-configuration`;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
}

function describeRequest(url: RequestInfo | URL, init: RequestInit): Record<string, unknown> {
  const headers = new Headers(init.headers || {});
  return {
    method: init.method || "GET",
    url: requestUrl(url),
    hasAuthorizationHeader: headers.has("authorization")
  };
}

function logAuth(message: string, details: Record<string, unknown>): void {
  log.warn(`auth: ${message}`, details);
}

function getCachedUmaToken(cacheKey: string): CachedUmaToken | null {
  const token = umaTokenCache.get(cacheKey);
  if (!token) {
    return null;
  }
  if (token.expiresAt && token.expiresAt <= Date.now()) {
    umaTokenCache.delete(cacheKey);
    log.info("evicted expired cached UMA RPT", { cacheKey });
    return null;
  }
  return token;
}

function setCachedUmaToken(cacheKey: string, rpt: UmaTokenResponse, request: Record<string, unknown>): void {
  if (!rpt.access_token || !rpt.token_type) {
    return;
  }
  const expiresAt = rpt.expires_in ? Date.now() + rpt.expires_in * 1000 - UMA_TOKEN_EXPIRY_SKEW_MS : null;
  umaTokenCache.set(cacheKey, {
    accessToken: rpt.access_token,
    tokenType: rpt.token_type,
    expiresAt
  });
  log.info("cached UMA RPT", {
    ...request,
    cacheKey,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
  });
}

function umaTokenCacheKey(url: RequestInfo | URL, init: RequestInit): string {
  return `${(init.method || "GET").toUpperCase()} ${requestUrl(url)}`;
}

function requestUrl(url: RequestInfo | URL): string {
  const value = typeof url === "string" || url instanceof URL ? url.toString() : "url" in url ? url.url : String(url);
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch (_err) {
    return value;
  }
}
