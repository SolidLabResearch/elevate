import { Inject, Injectable } from "@angular/core";
import { Activity } from "@elevate/shared/models/sync/activity.model";
import { QueryEngine } from "@incremunica/query-sparql-incremental";
import { isAddition } from "@incremunica/user-tools";
import { SolidConnectorInfoService } from "../../services/solid-connector-info/solid-connector-info.service";
import fetch from "cross-fetch";
import { ActivityQueryOptions, ActivityRDFMapper } from "./activityRDFMapper";
import { ActivityMaterializedRdfStore } from "./activity-materialized-rdf-store";
import { v4 as uuidv4 } from "uuid";
import { Subject } from "rxjs";
import { Auth } from "trustflows-client";
import { SolidAuthSession } from "@elevate/shared/sync/connectors/solid-connector-info.model";
import { UmaAccessRequest } from "@elevate/shared/sync/uma/uma-access-request";
import { activityRdfFetchCache } from "./rdf-fetch-cache";
import { DataFactory, Parser, Store } from "n3";

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

interface BindingsStream {
  destroy(): void;
  read(): any;
  on(event: "readable", listener: () => void): this;
}

@Injectable()
export class ActivityDao {
  private static readonly CONTAINER_CREATION_RETRY_DELAY_MS = 1000;
  private static readonly ID_TOKEN_CLAIM_FORMAT = "http://openid.net/specs/openid-connect-core-1_0.html#IDToken";
  private static readonly UMA_TOKEN_EXPIRY_SKEW_MS = 5000;
  private static sharedQueryEngine: QueryEngine | null = null;

  private source = "/activities";
  private rawSource = "/raw-activities";
  private activityMapping: ActivityRDFMapper;
  private materializedRdfStore: ActivityMaterializedRdfStore;
  private queryEngine: QueryEngine;
  private activityLocationsBindingsStream: BindingsStream;
  private _activityLocations: string[] = [];
  private activityLocationPromise: Promise<void> | null;
  private auth: Auth;
  private authFetch: typeof globalThis.fetch;
  private requestedAccessKeys: Set<string> = new Set<string>();
  private umaTokenCache: Map<string, CachedUmaToken> = new Map<string, CachedUmaToken>();
  private umaMetadataCache: Map<string, Promise<UmaMetadata>> = new Map<string, Promise<UmaMetadata>>();
  private initialActivityLocationsPromise: Promise<void> | null = null;
  public newActivityLocations$: Subject<string> = new Subject<string>();

  constructor(
    @Inject(SolidConnectorInfoService) private readonly solidConnectorInfoService: SolidConnectorInfoService
  ) {
    this.init();
  }

  public init(): void {
    activityRdfFetchCache.clear();
    this.umaTokenCache.clear();
    this.umaMetadataCache.clear();
    const baseFetch: typeof globalThis.fetch =
      typeof window !== "undefined" && typeof window.fetch === "function"
        ? window.fetch.bind(window)
        : (fetch as unknown as typeof globalThis.fetch);
    this.auth = new Auth({ fetch: baseFetch });
    this.authFetch = this.auth.createAuthFetch();
    this.activityMapping = new ActivityRDFMapper((input: RequestInfo | URL, init?: RequestInit) =>
      activityRdfFetchCache.fetch(this.fetchWithAccessTokenFirst.bind(this), input, init)
    );
    this.materializedRdfStore = new ActivityMaterializedRdfStore(
      this.activityMapping,
      this.fetchWithAccessTokenFirst.bind(this)
    );
    if (this.isAggregatorConfigured()) {
      console.info("[ActivityDao] Using main-process Solid activity container view");
      this._activityLocations = [];
      this.initialActivityLocationsPromise = null;
      return;
    }
    this.queryEngine = ActivityDao.getSharedQueryEngine();
    this.initialActivityLocationsPromise = this.subscribeActivityLocations()
      .catch(error => {
        console.error("Error while subscribing to Solid activity locations:", error);
      })
      .finally(() => {
        this.initialActivityLocationsPromise = null;
      });
  }

  private static getSharedQueryEngine(): QueryEngine {
    if (!ActivityDao.sharedQueryEngine) {
      ActivityDao.sharedQueryEngine = new QueryEngine();
    }
    return ActivityDao.sharedQueryEngine;
  }

  get activityLocations() {
    if (this.getSelectedAthleteWebIds().length === 0) {
      return Promise.resolve([]);
    }
    if (this.activityLocationPromise) {
      return this.activityLocationPromise.then(() => this.getSelectedActivityLocations(this._activityLocations));
    }
    if (this.initialActivityLocationsPromise) {
      return this.initialActivityLocationsPromise.then(() =>
        this.getSelectedActivityLocations(this._activityLocations)
      );
    }
    return Promise.resolve(this.getSelectedActivityLocations(this._activityLocations));
  }

  public async pollForNewActivityLocations(
    expectedNewCount: number = 1,
    timeoutMs: number = 120000,
    intervalMs: number = 2000
  ): Promise<string[]> {
    const knownLocations = new Set(await this.activityLocations);
    const discoveredLocations: string[] = [];
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;

    console.info("[ActivityDao] Activity location poll started", {
      expectedNewCount,
      timeoutMs,
      intervalMs,
      knownLocationCount: knownLocations.size
    });

    while (Date.now() <= deadline) {
      attempt++;
      const latestLocations = await this.fetchActivityLocationsSnapshot();
      const previousDiscoveredCount = discoveredLocations.length;
      for (const activityLocation of latestLocations) {
        if (knownLocations.has(activityLocation)) {
          continue;
        }

        knownLocations.add(activityLocation);
        this._activityLocations.push(activityLocation);
        discoveredLocations.push(activityLocation);
        console.log("Activity location added by poll:", activityLocation);
        this.newActivityLocations$.next(activityLocation);
      }

      console.info("[ActivityDao] Activity location poll attempt completed", {
        attempt,
        latestLocationCount: latestLocations.length,
        newLocationCount: discoveredLocations.length - previousDiscoveredCount,
        totalDiscoveredCount: discoveredLocations.length
      });

      if (discoveredLocations.length >= expectedNewCount) {
        console.info("[ActivityDao] Activity location poll completed", {
          discoveredLocationCount: discoveredLocations.length,
          discoveredLocations
        });
        return discoveredLocations;
      }

      await this.sleep(intervalMs);
    }

    console.warn("[ActivityDao] Activity location poll timed out", {
      expectedNewCount,
      discoveredLocationCount: discoveredLocations.length,
      discoveredLocations
    });
    return discoveredLocations;
  }

  public setActivityLocationsSnapshot(activityLocations: string[], invalidatedActivityLocations: string[] = []): void {
    const previousLocations = new Set(this._activityLocations);
    const nextLocations = Array.from(new Set(activityLocations));
    const nextLocationSet = new Set(nextLocations);
    const addedLocations = nextLocations.filter(activityLocation => !previousLocations.has(activityLocation));
    const removedLocations = this._activityLocations.filter(activityLocation => !nextLocationSet.has(activityLocation));
    const containerIri = `${this.solidConnectorInfoService.fetch().base}${this.source}/`;
    const invalidatedSources = Array.from(
      new Set([containerIri, ...removedLocations, ...invalidatedActivityLocations].filter(Boolean))
    );

    this._activityLocations = nextLocations;
    void this.materializedRdfStore.applySnapshot(this._activityLocations, invalidatedSources).catch(error => {
      console.error("[ActivityDao] Unable to update materialized activity RDF store from snapshot.", error);
    });
    console.info("[ActivityDao] Activity location snapshot updated", {
      activityLocationCount: this._activityLocations.length,
      addedLocationCount: addedLocations.length,
      removedLocationCount: removedLocations.length,
      activityLocations: this._activityLocations.slice(0, 10)
    });

    addedLocations.forEach(activityLocation => this.newActivityLocations$.next(activityLocation));
  }

  private async fetchActivityLocationsSnapshot(): Promise<string[]> {
    const bases = this.getSelectedBases();
    if (bases.length === 0) {
      return [];
    }
    activityRdfFetchCache.clear();

    const locations = await Promise.all(
      bases.map(async base => {
        const containerIri = `${base}${this.source}/`;
        const response = await this.fetchWithAccessTokenFirst(containerIri, {
          headers: {
            Accept: "text/turtle"
          }
        });
        console.info("[ActivityDao] Activity location poll fetch completed", {
          containerIri,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok
        });
        if (response.status === 404) {
          return [];
        }
        if (!response.ok) {
          throw new Error(`Failed to refresh activity locations: ${response.status} ${response.statusText}`);
        }

        return this.parseActivityLocations(containerIri, await response.text());
      })
    );
    const activityLocations = Array.from(new Set(locations.reduce((acc, value) => acc.concat(value), [] as string[])));
    console.info("[ActivityDao] Activity location poll parsed container", {
      activityLocationCount: activityLocations.length,
      activityLocations: activityLocations.slice(0, 10)
    });
    return activityLocations;
  }

  private isAggregatorConfigured(): boolean {
    return Boolean(this.solidConnectorInfoService.fetch()?.aggregatorUrl);
  }

  private parseActivityLocations(containerIri: string, turtle: string): Promise<string[]> {
    const store = new Store();
    const parser = new Parser({ baseIRI: containerIri, format: "text/turtle" });

    return new Promise<string[]>((resolve, reject) => {
      parser.parse(turtle, (error, quad) => {
        if (error) {
          reject(error);
          return;
        }

        if (quad) {
          store.addQuad(quad);
          return;
        }

        resolve(
          store
            .getQuads(
              DataFactory.namedNode(containerIri),
              DataFactory.namedNode("http://www.w3.org/ns/ldp#contains"),
              null,
              null
            )
            .map(quad => quad.object.value)
        );
      });
    });
  }

  private async subscribeActivityLocations(): Promise<void> {
    const bases = this.getSelectedBases();
    if (bases.length === 0) {
      this._activityLocations = [];
      this.materializedRdfStore.reset();
      return;
    }
    const containerIris = bases.map(base => `${base}${this.source}/`);
    for (const base of bases) {
      await this.ensureContainerExists(`${base}${this.source}/`);
      await this.ensureContainerExists(`${base}${this.rawSource}/`);
    }

    console.info("[ActivityDao] Subscribing to activity location stream", { containerIris });

    if (this.activityLocationsBindingsStream) {
      console.info("[ActivityDao] Destroying previous activity location stream");
      this.activityLocationsBindingsStream.destroy();
    }

    const TIMEOUT_MS = 100;
    let resolve: () => void | null;
    let timeoutId: NodeJS.Timeout | null = null;

    this.activityLocationPromise = new Promise<void>(resolvingF => {
      resolve = resolvingF;
    });

    const resolveWithTimeout = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        if (resolve) {
          resolve();
          resolve = null;
          this.activityLocationPromise = null;
        }
      }, TIMEOUT_MS);
    };

    this.activityLocationsBindingsStream = await this.queryEngine.queryBindings(
      `
PREFIX ldp: <http://www.w3.org/ns/ldp#>
SELECT ?activityIri WHERE {
  VALUES ?activityContainer { ${containerIris.map(containerIri => `<${containerIri}>`).join(" ")} }
  ?activityContainer ldp:contains ?activityIri .
}
`,
      {
        sources: containerIris as [string, ...string[]],
        lenient: true,
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          activityRdfFetchCache.fetch(this.fetchWithAccessTokenFirst.bind(this), input, init)
      }
    );

    this._activityLocations = [];
    const readBindingsStream = () => {
      console.info("[ActivityDao] Activity location stream readable");
      let bindings = this.activityLocationsBindingsStream.read();
      if (!bindings) {
        console.info("[ActivityDao] Activity location stream readable without bindings");
        return;
      }
      if (!resolve) {
        this.activityLocationPromise = new Promise<void>(resolvingF => {
          resolve = resolvingF;
        });
      }
      let additionCount = 0;
      let removalCount = 0;
      while (bindings) {
        resolveWithTimeout();
        const activityIri = bindings.get("activityIri");
        if (activityIri) {
          const activityLocation = activityIri.value;
          if (isAddition(bindings)) {
            if (!this._activityLocations.includes(activityLocation)) {
              console.log("Activity location added from stream:", activityLocation);
              this._activityLocations.push(activityLocation);
              this.newActivityLocations$.next(activityLocation);
              additionCount++;
            } else {
              console.info("[ActivityDao] Activity location stream emitted existing location", { activityLocation });
            }
          } else {
            const index = this._activityLocations.findIndex((location: string) => location === activityLocation);
            if (index >= 0) {
              this._activityLocations.splice(index, 1);
              removalCount++;
              console.log("Activity location removed from stream:", activityLocation);
            } else {
              console.info("[ActivityDao] Activity location stream removed unknown location", { activityLocation });
            }
          }
        }
        bindings = this.activityLocationsBindingsStream.read();
      }
      console.info("[ActivityDao] Activity location stream batch processed", {
        additionCount,
        removalCount,
        activityLocationCount: this._activityLocations.length,
        activityLocations: this._activityLocations.slice(0, 10)
      });
      if (additionCount || removalCount) {
        void this.materializedRdfStore.applySnapshot(this._activityLocations).catch(error => {
          console.error("[ActivityDao] Unable to update materialized activity RDF store from stream.", error);
        });
      }
    };
    readBindingsStream();
    resolveWithTimeout();
    this.activityLocationsBindingsStream.on("readable", readBindingsStream);

    const initialActivityLocationPromise = this.activityLocationPromise;
    if (initialActivityLocationPromise) {
      await initialActivityLocationPromise;
    }
    console.info("[ActivityDao] Initial activity location discovery completed", {
      activityLocationCount: this._activityLocations.length,
      activityLocations: this._activityLocations.slice(0, 5)
    });
  }

  private async ensureContainerExists(containerIri: string): Promise<void> {
    while (true) {
      const getResponse = await this.fetchWithAccessTokenFirst(containerIri, { method: "GET" });
      if (getResponse.ok) {
        return;
      }
      if (getResponse.status === 401) {
        throw new Error(`Access to Solid container ${containerIri} is unauthorized. An access request was submitted.`);
      }

      const putResponse = await this.fetchWithAccessTokenFirst(containerIri, { method: "PUT" });
      if (putResponse.ok || putResponse.status === 409 || putResponse.status === 412) {
        return;
      }

      const status = putResponse.status || getResponse.status || 0;
      const statusText = putResponse.statusText || getResponse.statusText || "Unknown error";
      if (status !== 401) {
        console.error("Error creating Solid container:", containerIri, status, statusText);
        throw new Error(`Failed to create Solid container at ${containerIri}: ${status} ${statusText}`);
      }

      await this.sleep(ActivityDao.CONTAINER_CREATION_RETRY_DELAY_MS);
    }
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationMs));
  }

  private async fetchWithAccessTokenFirst(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    this.refreshAuthFromLatestSession();
    const method = (init.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      activityRdfFetchCache.clear();
    }
    const target = this.resolveRequestTarget(input);
    const cacheKey = this.umaTokenCacheKey(input, init);
    try {
      const cachedToken = this.getCachedUmaToken(cacheKey);
      if (cachedToken) {
        const cachedHeaders = new Headers(init.headers || {});
        cachedHeaders.set("authorization", `${cachedToken.tokenType} ${cachedToken.accessToken}`);
        const cachedResponse = await this.baseFetch(input, { ...init, headers: cachedHeaders });
        if (this.shouldLogRequest(target)) {
          console.info(
            `[ActivityDao] ${method} ${target} -> ${cachedResponse.status} ${cachedResponse.statusText} (cached UMA RPT)`
          );
        }
        if (cachedResponse.status !== 401) {
          return cachedResponse;
        }
        this.umaTokenCache.delete(cacheKey);
        console.warn(`[ActivityDao] Evicted cached UMA RPT for ${method} ${target} after 401.`);
      }

      const response = await this.authFetch(input, init);
      if (this.shouldLogRequest(target)) {
        const outcome = response.ok ? "success" : "failure";
        const logFn = response.ok ? console.info : console.warn;
        logFn(`[ActivityDao] ${method} ${target} -> ${response.status} ${response.statusText} (${outcome})`);
      }
      if (response.status === 401) {
        const rptResponse = await this.retryWithUmaToken(input, init, response, cacheKey);
        if (rptResponse) {
          return rptResponse;
        }
        await this.requestAccessOnUnauthorized(target, method, response);
      }
      return response;
    } catch (error) {
      if (this.shouldLogRequest(target)) {
        console.error(`[ActivityDao] ${method} ${target} -> request error`, error);
      }
      if (this.isUmaAuthorizationError(error)) {
        await this.requestAccessOnUnauthorized(target, method);
      }
      throw error;
    }
  }

  private resolveRequestTarget(input: RequestInfo | URL): string {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.toString();
    }
    return input.url;
  }

  private shouldLogRequest(target: string): boolean {
    return target.includes("/activities/") || target.includes("/raw-activities/");
  }

  private async requestAccessOnUnauthorized(target: string, method: string, response?: Response): Promise<void> {
    const requestKey = `${method} ${target}`;
    if (this.requestedAccessKeys.has(requestKey)) {
      return;
    }

    this.requestedAccessKeys.add(requestKey);
    const authSession = this.getLatestAuthSession();
    const requestingParty = this.auth.webId || authSession?.webId || this.solidConnectorInfoService.fetch().webId;

    try {
      const result = await UmaAccessRequest.request({
        fetch: typeof window !== "undefined" && typeof window.fetch === "function" ? window.fetch.bind(window) : fetch,
        requestingParty,
        requestedTarget: target,
        requestedAction: UmaAccessRequest.actionForMethod(method),
        response
      });

      if (result.requested) {
        console.info(`[ActivityDao] UMA access request submitted for ${target} at ${result.accessRequestUrl}`);
      } else {
        console.warn(`[ActivityDao] UMA access request was not submitted for ${target}: ${result.reason}`);
      }
    } catch (error) {
      console.warn(`[ActivityDao] Unable to submit UMA access request for ${target}.`, error);
    }
  }

  private isUmaAuthorizationError(error: unknown): boolean {
    const authorizationError = error as { name?: string; status?: number };
    return (
      authorizationError?.name === "TokenRequestError" ||
      authorizationError?.status === 400 ||
      authorizationError?.status === 401 ||
      authorizationError?.status === 403
    );
  }

  private async retryWithUmaToken(
    input: RequestInfo | URL,
    init: RequestInit,
    response: Response,
    cacheKey: string
  ): Promise<Response | null> {
    const target = this.resolveRequestTarget(input);
    const method = (init.method || "GET").toUpperCase();
    const authSession = this.getLatestAuthSession();
    const idToken = authSession?.idToken || this.auth.oidcToken || null;
    const challenge = this.parseUmaChallenge(response.headers.get("www-authenticate"));
    if (!challenge?.asUri || !challenge.ticket || !idToken) {
      console.warn(
        `[ActivityDao] ${method} ${target} -> UMA retry unavailable ` +
          `(hasAsUri=${Boolean(challenge?.asUri)}, hasTicket=${Boolean(challenge?.ticket)}, hasIdToken=${Boolean(
            idToken
          )}).`
      );
      return null;
    }

    const rpt = await this.requestUmaToken(challenge, idToken, method, target);
    if (!rpt.access_token || !rpt.token_type) {
      console.warn(`[ActivityDao] UMA token response for ${method} ${target} did not include a usable RPT.`);
      return null;
    }

    this.setCachedUmaToken(cacheKey, rpt, method, target);
    const rptHeaders = new Headers(init.headers || {});
    rptHeaders.set("authorization", `${rpt.token_type} ${rpt.access_token}`);
    const rptResponse = await this.baseFetch(input, { ...init, headers: rptHeaders });
    if (this.shouldLogRequest(target)) {
      console.info(`[ActivityDao] ${method} ${target} -> ${rptResponse.status} ${rptResponse.statusText} (UMA RPT)`);
    }
    if (rptResponse.status === 401) {
      this.umaTokenCache.delete(cacheKey);
    }
    return rptResponse;
  }

  private async requestUmaToken(
    challenge: UmaChallenge,
    idToken: string,
    method: string,
    target: string
  ): Promise<UmaTokenResponse> {
    const metadata = await this.discoverUmaMetadata(challenge.asUri);
    if (!metadata.token_endpoint) {
      throw new Error(`UMA metadata at ${challenge.asUri} does not include token_endpoint.`);
    }

    console.info(
      `[ActivityDao] Requesting UMA RPT for ${method} ${target} at ${metadata.token_endpoint} ` +
        `(claim_token_format=${ActivityDao.ID_TOKEN_CLAIM_FORMAT}).`
    );
    const tokenResponse = await this.baseFetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:uma-ticket",
        ticket: challenge.ticket,
        claim_token: idToken,
        claim_token_format: ActivityDao.ID_TOKEN_CLAIM_FORMAT
      })
    });
    const body = await this.safeJson(tokenResponse);
    if (!tokenResponse.ok) {
      throw new Error(`UMA token request failed (${tokenResponse.status}): ${JSON.stringify(body)}`);
    }
    return body as UmaTokenResponse;
  }

  private async discoverUmaMetadata(asUri: string): Promise<UmaMetadata> {
    const metadataUrl = asUri.includes("/.well-known/")
      ? asUri
      : `${asUri.replace(/\/+$/u, "")}/.well-known/uma2-configuration`;
    const cached = this.umaMetadataCache.get(metadataUrl);
    if (cached) {
      return cached;
    }

    const metadataPromise = this.baseFetch(metadataUrl, { headers: { accept: "application/json" } }).then(
      async response => {
        if (!response.ok) {
          throw new Error(`UMA metadata discovery failed at ${metadataUrl}: ${response.status}`);
        }
        return (await response.json()) as UmaMetadata;
      }
    );
    this.umaMetadataCache.set(metadataUrl, metadataPromise);
    try {
      return await metadataPromise;
    } catch (error) {
      this.umaMetadataCache.delete(metadataUrl);
      throw error;
    }
  }

  private parseUmaChallenge(header: string | null): UmaChallenge | null {
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

  private getCachedUmaToken(cacheKey: string): CachedUmaToken | null {
    const token = this.umaTokenCache.get(cacheKey);
    if (!token) {
      return null;
    }
    if (token.expiresAt && token.expiresAt <= Date.now()) {
      this.umaTokenCache.delete(cacheKey);
      return null;
    }
    return token;
  }

  private setCachedUmaToken(cacheKey: string, rpt: UmaTokenResponse, method: string, target: string): void {
    if (!rpt.access_token || !rpt.token_type) {
      return;
    }
    const expiresAt = rpt.expires_in ? Date.now() + rpt.expires_in * 1000 - ActivityDao.UMA_TOKEN_EXPIRY_SKEW_MS : null;
    this.umaTokenCache.set(cacheKey, {
      accessToken: rpt.access_token,
      tokenType: rpt.token_type,
      expiresAt
    });
    console.info(
      `[ActivityDao] Cached UMA RPT for ${method} ${target}${
        expiresAt ? ` until ${new Date(expiresAt).toISOString()}` : ""
      }.`
    );
  }

  private umaTokenCacheKey(input: RequestInfo | URL, init: RequestInit): string {
    return `${(init.method || "GET").toUpperCase()} ${this.requestUrl(input)}`;
  }

  private requestUrl(input: RequestInfo | URL): string {
    const value = this.resolveRequestTarget(input);
    try {
      const url = new URL(value);
      url.hash = "";
      return url.toString();
    } catch (_error) {
      return value;
    }
  }

  private baseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const baseFetch =
      typeof window !== "undefined" && typeof window.fetch === "function"
        ? window.fetch.bind(window)
        : (fetch as unknown as typeof globalThis.fetch);
    return baseFetch(input as any, init as any) as Promise<Response>;
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  }

  private refreshAuthFromLatestSession(): void {
    const authSession = this.getLatestAuthSession();
    if (!authSession) {
      return;
    }

    this.auth.oidcAccessToken = authSession.accessToken || undefined;
    this.auth.oidcToken = authSession.idToken || undefined;
    this.auth.oidcRefreshToken = authSession.refreshToken || undefined;
    this.auth.oidcTokenExpiry = authSession.expiresAt || undefined;
    this.auth.webId = authSession.webId || this.solidConnectorInfoService.fetch().webId || undefined;

    if (!authSession.idToken && (authSession.accessToken || authSession.refreshToken)) {
      console.warn("[ActivityDao] Solid auth session is missing OIDC id_token; UMA claims may fail.");
    }
  }

  private getLatestAuthSession(): SolidAuthSession | null {
    const connectorInfo = this.solidConnectorInfoService.fetch();
    if (connectorInfo?.authSession) {
      return connectorInfo.authSession;
    }

    const storage = typeof sessionStorage !== "undefined" ? sessionStorage : null;
    if (!storage) {
      return null;
    }

    try {
      const rawTokens = storage.getItem("oidc_tokens");
      if (!rawTokens) {
        return null;
      }

      const parsedTokens = JSON.parse(rawTokens);
      return {
        accessToken: parsedTokens?.access_token || null,
        idToken: parsedTokens?.id_token || null,
        refreshToken: parsedTokens?.refresh_token || null,
        expiresAt: parsedTokens?.expires_at || null,
        webId: parsedTokens?.web_id || null,
        issuer: storage.getItem("oidc_issuer"),
        clientId: storage.getItem("oidc_client_id"),
        redirectUri: storage.getItem("oidc_redirect_uri")
      };
    } catch (error) {
      console.warn("[ActivityDao] Unable to parse stored OIDC tokens from sessionStorage.", error);
      return null;
    }
  }

  private getSelectedAthleteWebIds(): string[] {
    return this.solidConnectorInfoService.fetch().selectedAthleteWebIds;
  }

  private getSelectedBases(): string[] {
    return this.getSelectedAthleteWebIds().map(webId => webId.replace("/profile/card#me", ""));
  }

  private getSelectedActivityLocations(activityLocations: string[]): string[] {
    const bases = this.getSelectedBases();
    if (bases.length === 0) {
      return [];
    }
    return activityLocations.filter(activityLocation =>
      bases.some(base => activityLocation.startsWith(`${base}${this.source}/`))
    );
  }

  private getSelectedActivityContainers(): string[] {
    return this.getSelectedBases().map(base => `${base}${this.source}/`);
  }

  private async getDefaultSources(sources?: string[]): Promise<[string, ...string[]]> {
    if (!sources || sources.length === 0) {
      const activityLocations = await this.activityLocations;
      const containers = this.getSelectedActivityContainers();
      return [...containers, ...activityLocations] as [string, ...string[]];
    }
    if (!this.solidConnectorInfoService.fetch() || this.solidConnectorInfoService.fetch().base === "") {
      return Promise.resolve(["https://solidlabresearch.github.io/activity-ontology/", ...sources]);
    }
    return Promise.resolve([...sources]) as Promise<[string, ...string[]]>;
  }

  private async queryMaterializedActivities(options?: ActivityQueryOptions): Promise<Activity[] | number | boolean> {
    return this.materializedRdfStore.query(await this.activityLocations, options) as Promise<
      Activity[] | number | boolean
    >;
  }

  public async findByDatedSession(startTime: string, endTime: string): Promise<Activity[]> {
    return this.queryMaterializedActivities({
      filterKeys: [
        {
          key: "activity_startTime",
          relationKeyToValue: ">",
          value: new Date(startTime)
        },
        {
          key: "activity_endTime",
          relationKeyToValue: ">",
          value: new Date(endTime)
        }
      ]
    }) as Promise<Activity[]>;
  }

  public async findSorted(descending: boolean): Promise<Activity[]> {
    const activityLocations = await this.activityLocations;
    console.info("[ActivityDao] findSorted started", {
      descending,
      sourceCount: 1,
      activityLocationCount: activityLocations.length,
      activityLocations: activityLocations.slice(0, 5)
    });
    const activities = (await this.materializedRdfStore.query(activityLocations, {
      sort: {
        key: "activity_startTime",
        ascending: !descending
      }
    })) as Activity[];
    console.info("[ActivityDao] findSorted completed", { count: activities.length });
    return activities;
  }

  public async hasActivitiesWithSettingsLacks(): Promise<boolean> {
    return this.queryMaterializedActivities({
      keys: ["activity_settingsLack"],
      boundKeys: [
        {
          key: "activity_settingsLack",
          value: true
        }
      ],
      type: "ask"
    }) as Promise<boolean>;
  }

  public async findActivitiesWithSettingsLacks(keys?: string[]): Promise<Activity[]> {
    return this.queryMaterializedActivities({
      keys,
      boundKeys: [
        {
          key: "activity_settingsLack",
          value: true
        }
      ]
    }) as Promise<Activity[]>;
  }

  public async find(options?: {
    keys?: string[];
    boundKeys?: { key: string; value: string | number | Date | boolean }[];
    filterKeys?: (
      | { key: string; relationKeyToValue: string; value: string | number | Date | boolean }
      | {
          requiredKeys: string[];
          condition: string;
        }
    )[];
    sort?: { key: string; ascending: boolean };
    slice?: { limit: number; offset?: number };
    type?: "select" | "count" | "ask";
  }): Promise<Activity[]> {
    const activityLocations = await this.activityLocations;
    console.info("[ActivityDao] find started", {
      keyCount: options?.keys?.length ?? 0,
      filterCount: options?.filterKeys?.length ?? 0,
      sourceCount: 1,
      activityLocationCount: activityLocations.length,
      activityLocations: activityLocations.slice(0, 5)
    });
    const activities = (await this.materializedRdfStore.query(activityLocations, options)) as Activity[];
    console.info("[ActivityDao] find completed", { count: activities.length });
    return activities;
  }

  /*
  public async findOne(query?: { queryString: string; sources: [string, ...string[]] }): Promise<Activity> {
    if (!query) {
      return Promise.resolve((await this.query(null, null))[0]);
    }
    return Promise.resolve((await this.query(query.queryString, query.sources, 1))[0]);
  }
  */

  public async getById(id: number | string): Promise<Activity> {
    const activityId = String(id).replace(/["\\]/g, "\\$&");
    const startedAt = Date.now();
    const activityLocations = await this.activityLocations;
    const activitySource = activityLocations.find(location => {
      const normalizedLocation = location.split("#")[0];
      return normalizedLocation.endsWith(`/${activityId}`);
    });

    if (activitySource) {
      console.info("[ActivityDao] getById direct source query started", {
        id,
        activitySource
      });
      const activities = (await this.activityMapping.query([activitySource], {
        slice: {
          limit: 1
        }
      })) as Activity[];
      console.info("[ActivityDao] getById direct source query completed", {
        id,
        found: activities.length > 0,
        elapsedMs: Date.now() - startedAt
      });
      if (activities.length > 0) {
        return activities[0];
      }
    }

    console.info("[ActivityDao] getById materialized fallback query started", { id });
    const activities = (await this.queryMaterializedActivities({
      filterKeys: [
        {
          requiredKeys: ["activity"],
          condition: `(STRENDS(STR(?activity), "/${activityId}#activity") || STRENDS(STR(?activity), "/${activityId}"))`
        }
      ],
      slice: {
        limit: 1
      }
    })) as Activity[];
    console.info("[ActivityDao] getById materialized fallback query completed", {
      id,
      found: activities.length > 0,
      elapsedMs: Date.now() - startedAt
    });
    return activities[0];
  }

  public async insert(activity: Activity, waitSaveDrained: boolean = false): Promise<Activity> {
    let location = this.solidConnectorInfoService.fetch().base + this.source;
    if (!activity.id) {
      activity.id = uuidv4();
    }
    location += `/${activity.id}`;
    let promise = this.fetchWithAccessTokenFirst(location, {
      method: "PUT",
      headers: {
        "Content-Type": "text/turtle"
      },
      body: this.activityMapping.write(location, activity)
    }).then(async response => {
      if (!response.ok) {
        console.error("Error inserting document:", location, activity, response.statusText);
        return;
      }
      if (!this._activityLocations.includes(location)) {
        this._activityLocations.push(location);
      }
      await this.materializedRdfStore.applySnapshot(this._activityLocations, [location]);
    });
    if (waitSaveDrained) {
      await promise;
      return this.getById(activity.id);
    }
    return activity;
  }

  public async insertMany(activities: Activity[], waitSaveDrained: boolean = false): Promise<void> {
    let promises = activities.map((activity: Activity) => this.insert(activity, waitSaveDrained));
    if (waitSaveDrained) {
      await Promise.all(promises);
    }
  }

  public async update(activity: Activity, waitSaveDrained: boolean = false): Promise<Activity> {
    return this.insert(activity, waitSaveDrained);
  }

  public async put(activity: Activity, waitSaveDrained: boolean = false): Promise<Activity> {
    return this.insert(activity, waitSaveDrained);
  }

  public async remove(activity: Activity, waitSaveDrained: boolean = false): Promise<void> {
    let location = this.solidConnectorInfoService.fetch().base + this.source + `/${activity.id}`;
    let promise = this.fetchWithAccessTokenFirst(location, {
      method: "DELETE"
    }).then(async response => {
      if (!response.ok) {
        console.error("Error remove document:", location, activity, response.statusText);
        return;
      }
      this._activityLocations = this._activityLocations.filter(activityLocation => activityLocation !== location);
      await this.materializedRdfStore.applySnapshot(this._activityLocations, [location]);
    });
    if (waitSaveDrained) {
      await promise;
    }
  }

  public async removeById(id: number | string, waitSaveDrained: boolean = false): Promise<void> {
    let location = this.solidConnectorInfoService.fetch().base + this.source + `/${id}`;
    let promise = this.fetchWithAccessTokenFirst(location, {
      method: "DELETE"
    }).then(async response => {
      if (!response.ok) {
        console.error("Error remove document by id:", location, id, response.statusText);
        return;
      }
      this._activityLocations = this._activityLocations.filter(activityLocation => activityLocation !== location);
      await this.materializedRdfStore.applySnapshot(this._activityLocations, [location]);
    });
    if (waitSaveDrained) {
      await promise;
    }
  }

  public async removeByManyIds(ids: (number | string)[], waitSaveDrained: boolean = false): Promise<void> {
    let promises = ids.map((id: number | string) => this.removeById(id, waitSaveDrained));
    if (waitSaveDrained) {
      await Promise.all(promises);
    }
  }

  /**
   * Count elements in datastore
   */
  public async count(options?: {
    boundKeys?: { key: string; value: any }[];
    filterKeys?: { key: string; relationKeyToValue: string; value: string | number | boolean | Date }[];
  }): Promise<number> {
    if (!options) {
      options = {
        boundKeys: [],
        filterKeys: []
      };
    }
    let keys = ["activity"];
    if (options.boundKeys) {
      options.boundKeys.forEach(boundKey => {
        if (!keys.includes(boundKey.key)) {
          keys.push(boundKey.key);
        }
      });
    }
    if (options.filterKeys) {
      options.filterKeys.forEach(filterKey => {
        if (!keys.includes(filterKey.key)) {
          keys.push(filterKey.key);
        }
      });
    }
    const activityLocations = await this.activityLocations;
    console.info("[ActivityDao] count started", {
      keyCount: keys.length,
      filterCount: options.filterKeys?.length ?? 0,
      sourceCount: 1,
      activityLocationCount: activityLocations.length,
      activityLocations: activityLocations.slice(0, 5)
    });
    const count = (await this.materializedRdfStore.query(activityLocations, {
      keys: keys,
      boundKeys: options.boundKeys,
      filterKeys: options.filterKeys,
      type: "count"
    })) as number;
    console.info("[ActivityDao] count completed", { count });
    return count;
  }

  /**
   * Clear all data
   */
  public async clear(waitSaveDrained: boolean = false): Promise<void> {
    activityRdfFetchCache.clear();
    this.materializedRdfStore.reset();
    const promises = (await this.activityLocations).map(location => {
      return this.fetchWithAccessTokenFirst(location, {
        method: "DELETE"
      }).then(response => {
        if (!response.ok) {
          console.error("Error clearing document:", location, response.statusText);
        }
      });
    });
    if (waitSaveDrained) {
      await Promise.all(promises);
    }
  }

  public async persist(waitSaveDrained: boolean = false): Promise<void> {
    console.error("BaseDao.persist() not implemented, I don't think this is necessary.");
  }
}
