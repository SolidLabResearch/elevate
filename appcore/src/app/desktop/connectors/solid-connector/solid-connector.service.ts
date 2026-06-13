import { Inject, Injectable } from "@angular/core";
import { DesktopSyncService } from "../../../shared/services/sync/impl/desktop-sync.service";
import { SyncService } from "../../../shared/services/sync/sync.service";
import { ConnectorService } from "../connector.service";
import { IPC_TUNNEL_SERVICE } from "../../ipc/ipc-tunnel-service.token";
import { IpcTunnelService } from "@elevate/shared/electron/ipc-tunnel";
import { ConnectorType } from "@elevate/shared/sync/connectors/connector-type.enum";
import { SolidConnectorInfoService } from "../../../shared/services/solid-connector-info/solid-connector-info.service";
import { SolidConnectorInfo } from "@elevate/shared/sync/connectors/solid-connector-info.model";
import { Auth } from "trustflows-client";
import fetch from "cross-fetch";
import { IpcMessage } from "@elevate/shared/electron/ipc-message";
import { Channel } from "@elevate/shared/electron/channels.enum";
import { SolidAuthSession } from "@elevate/shared/sync/connectors/solid-connector-info.model";
import { UmaAccessRequest } from "@elevate/shared/sync/uma/uma-access-request";
import { UmaRequestedAction } from "@elevate/shared/sync/uma/uma-access-request";
import { ElectronService } from "../../electron/electron.service";
import { AthleteService } from "../../../shared/services/athlete/athlete.service";
import { UserSettingsService } from "../../../shared/services/user-settings/user-settings.service";
import { AthleteModel } from "@elevate/shared/models/athlete/athlete.model";
import { DatedAthleteSettings } from "@elevate/shared/models/athlete/athlete-settings/dated-athlete-settings.model";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";
import { UserZonesModel } from "@elevate/shared/models/user-settings/user-zones.model";
import { ActivityDao } from "../../../shared/dao/activity/activity.dao";
import { Activity } from "@elevate/shared/models/sync/activity.model";
import { ActivityFileType } from "@elevate/shared/sync/connectors/activity-file-type.enum";
import { DataFactory, Parser, Store } from "n3";

interface SolidDesktopAuthResult {
  accessToken: string | null;
  idToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  webId: string | null;
  issuer: string;
  clientId: string;
  redirectUri: string;
}

interface AggregatorRegistrationStartResponse {
  aggregator_client_id?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  redirect_uri?: string;
  authorization_endpoint?: string;
  authorization_url?: string;
  state?: string;
}

interface SolidAggregatorAuthResult {
  aggregatorUrl: string | null;
  code?: string | null;
  state?: string | null;
  error?: string | null;
}

@Injectable()
export class SolidConnectorService extends ConnectorService {
  private static readonly RAW_ACTIVITY_CACHE_SIZE = 20;
  private static readonly CONTAINER_CREATION_RETRY_DELAY_MS = 1000;
  private static readonly ACTIVITY_CONTAINER_PATH = "/activities/";
  private static readonly RAW_ACTIVITY_CONTAINER_PATH = "/raw-activities/";
  private static readonly AGGREGATOR_POLL_DELAY_MS = 2000;
  private static readonly AGGREGATOR_POLL_ATTEMPTS = 60;
  private static readonly AGGREGATOR_ACCESS_POLL_DELAY_MS = 5000;
  private static readonly AGGREGATED_ACTIVITY_POLL_TIMEOUT_MS = 120000;
  private static readonly AGGREGATED_ACTIVITY_POLL_INTERVAL_MS = 2000;
  private static readonly DESKTOP_AGGREGATOR_RETURN_URL = "http://127.0.0.1:53682/solid-auth-callback";
  private static readonly PENDING_AGGREGATOR_AUTH_KEY = "solid_pending_aggregator_auth";

  private readonly auth: Auth;
  private readonly authFetch: typeof globalThis.fetch;
  private readonly requestedAccessKeys: Set<string> = new Set<string>();
  private readonly umaAccessRequestUrlByTarget: Map<string, string> = new Map<string, string>();
  private lastUmaAccessRequestUrl: string | null = null;
  private readonly rawActivityCache: Map<string, ArrayBuffer> = new Map<string, ArrayBuffer>();

  constructor(
    @Inject(IPC_TUNNEL_SERVICE) public readonly ipcTunnelService: IpcTunnelService,
    @Inject(SolidConnectorInfoService) public readonly solidConnectorInfoService: SolidConnectorInfoService,
    @Inject(SyncService) private readonly desktopSyncService: DesktopSyncService,
    @Inject(ElectronService) private readonly electronService: ElectronService,
    @Inject(AthleteService) private readonly athleteService: AthleteService,
    @Inject(UserSettingsService) private readonly userSettingsService: UserSettingsService,
    @Inject(ActivityDao) private readonly activityDao: ActivityDao
  ) {
    super();
    const baseFetch: typeof globalThis.fetch =
      typeof window !== "undefined" && typeof window.fetch === "function"
        ? window.fetch.bind(window)
        : (fetch as unknown as typeof globalThis.fetch);

    this.auth = new Auth({
      persistTokens: true,
      fetch: baseFetch
    });
    this.authFetch = this.auth.createAuthFetch();
  }

  public fetch(): Promise<SolidConnectorInfo> {
    return Promise.resolve(this.solidConnectorInfoService.fetch());
  }

  public updateAuthConfiguration(issuer: string | null): SolidConnectorInfo {
    const solidConnectorInfo = this.solidConnectorInfoService.fetch();
    return this.solidConnectorInfoService.save(
      new SolidConnectorInfo(
        solidConnectorInfo.webId,
        issuer && issuer.trim().length > 0 ? issuer.trim() : null,
        SolidConnectorInfo.DEFAULT_CLIENT_ID_URL,
        null,
        null,
        solidConnectorInfo.aggregatorBaseUrl,
        solidConnectorInfo.aggregatorUrl,
        solidConnectorInfo.followingAthleteWebIds,
        solidConnectorInfo.selectedAthleteWebIds
      )
    );
  }

  public getCurrentRedirectUri(): string {
    const redirectUri = new URL(window.location.href);
    redirectUri.search = "";
    redirectUri.hash = "";
    return redirectUri.toString();
  }

  public async login(issuer: string): Promise<void> {
    if (!issuer) {
      return Promise.reject(new Error("Solid issuer is required."));
    }

    const redirectUri = this.getCurrentRedirectUri();
    if (redirectUri.startsWith("file:")) {
      return this.desktopLogin(issuer);
    }

    await this.auth.login(issuer.trim(), SolidConnectorInfo.DEFAULT_CLIENT_ID_URL, redirectUri);
  }

  public async handleIncomingRedirect(): Promise<SolidConnectorInfo | null> {
    const handled = await this.auth.handleIncomingRedirect();
    if (!handled) {
      return null;
    }

    const solidConnectorInfo = this.solidConnectorInfoService.fetch();
    const updated = this.selectLoggedInAthlete(
      new SolidConnectorInfo(
        this.auth.webId || solidConnectorInfo.webId,
        solidConnectorInfo.issuer,
        solidConnectorInfo.clientId,
        this.buildCurrentAuthSession(solidConnectorInfo),
        null,
        solidConnectorInfo.aggregatorBaseUrl,
        solidConnectorInfo.aggregatorUrl,
        solidConnectorInfo.followingAthleteWebIds,
        solidConnectorInfo.selectedAthleteWebIds
      )
    );
    await this.ensureDefaultContainers();
    return (await this.restoreConnectorPreferencesFromPod()) || updated;
  }

  public async logout(): Promise<SolidConnectorInfo> {
    if (this.getCurrentRedirectUri().startsWith("file:")) {
      this.auth.clearCache();
    } else {
      await this.auth.logout(this.getCurrentRedirectUri());
    }

    return this.solidConnectorInfoService.resetLoggedOutState();
  }

  public async isLoggedIn(): Promise<boolean> {
    return this.auth.isLoggedIn();
  }

  public getWebId(): string | null {
    return this.auth.webId || null;
  }

  public async initializePodResourcesOnStartup(): Promise<void> {
    if (!(await this.isLoggedIn())) {
      return;
    }
    const solidConnectorInfo = this.syncConnectorInfoWithCurrentAuthSession();
    if (!solidConnectorInfo.base) {
      return;
    }
    await this.ensureDefaultContainers();
    await this.writeCurrentSettingsToPod();
  }

  private async desktopLogin(issuer: string): Promise<void> {
    console.info("[SolidConnectorService] Starting Solid desktop login.");
    const ipcMessage = new IpcMessage(Channel.solidLink, issuer.trim(), SolidConnectorInfo.DEFAULT_CLIENT_ID_URL);
    const result = await this.ipcTunnelService.send<IpcMessage, SolidDesktopAuthResult>(ipcMessage);

    this.auth.oidcAccessToken = result.accessToken || undefined;
    this.auth.oidcToken = result.idToken || undefined;
    this.auth.oidcRefreshToken = result.refreshToken || undefined;
    this.auth.oidcTokenExpiry = result.expiresAt || undefined;
    this.auth.webId = result.webId || undefined;
    this.auth.clearUmaCache();

    const storage = typeof sessionStorage !== "undefined" ? sessionStorage : null;
    if (storage) {
      storage.setItem("oidc_issuer", result.issuer);
      storage.setItem("oidc_client_id", result.clientId);
      storage.setItem("oidc_redirect_uri", result.redirectUri);
      storage.setItem(
        "oidc_tokens",
        JSON.stringify({
          access_token: result.accessToken,
          id_token: result.idToken,
          refresh_token: result.refreshToken,
          expires_at: result.expiresAt,
          web_id: result.webId
        })
      );
    }

    this.syncConnectorInfoWithCurrentAuthSession();
    console.info(`[SolidConnectorService] Solid desktop login completed for ${result.webId || "unknown WebID"}.`);

    try {
      await this.ensureDefaultContainers();
      await this.restoreConnectorPreferencesFromPod();
      await this.writeCurrentSettingsToPod();
    } catch (error) {
      console.warn("[SolidConnectorService] Solid login succeeded, but post-login pod initialization failed.", error);
    }
  }

  /**
   *
   */
  public async sync(): Promise<void> {
    this.syncConnectorInfoWithCurrentAuthSession();
    if (this.solidConnectorInfoService.fetch().selectedAthleteWebIds.length === 0) {
      this.activityDao.init();
      return;
    }
    await this.ensureDefaultContainers();
    await this.writeCurrentSettingsToPod();
    await this.ensureAggregatorInitialized();
    return this.desktopSyncService.sync(null, null, ConnectorType.SOLID);
  }

  public async writeConnectorPreferencesToPod(): Promise<void> {
    await this.ensureDefaultContainers();
    await this.writeCurrentSettingsToPod();
  }

  /**
   *
   */
  public stop(): Promise<void> {
    return this.desktopSyncService.stop();
  }

  public refreshActivitySelection(): void {
    this.activityDao.init();
  }

  public async getDeflatedStreamsForActivity(activity: Activity): Promise<string | null> {
    const rawActivityPath = activity?.extras?.file?.path;
    const fileType = this.getActivityFileType(activity?.extras?.file?.type || rawActivityPath);
    if (!rawActivityPath || !fileType) {
      return null;
    }

    const startedAt = Date.now();
    console.info("[SolidStreamsTiming] raw stream load started", {
      activityId: activity.id,
      rawActivityPath,
      fileType
    });
    const rawActivityBuffer = await this.getRawActivityBuffer(rawActivityPath);
    if (!rawActivityBuffer) {
      console.warn("[SolidStreamsTiming] raw activity stream unavailable, skipping stream compute", {
        activityId: activity.id,
        rawActivityPath
      });
      return null;
    }
    console.info("[SolidStreamsTiming] raw activity buffer ready", {
      activityId: activity.id,
      elapsedMs: Date.now() - startedAt,
      byteLength: rawActivityBuffer.byteLength
    });
    const ipcMessage = new IpcMessage(Channel.computeSolidRawStreams, {
      rawActivityBuffer,
      fileType,
      activityStartTime: activity.startTime
    });
    const ipcStartedAt = Date.now();
    const deflatedStreams = await this.ipcTunnelService.send<IpcMessage, string | null>(ipcMessage);
    console.info("[SolidStreamsTiming] raw activity stream compute completed", {
      activityId: activity.id,
      elapsedMs: Date.now() - ipcStartedAt,
      totalElapsedMs: Date.now() - startedAt,
      hasDeflatedStreams: Boolean(deflatedStreams),
      deflatedSize: deflatedStreams?.length || 0
    });
    return deflatedStreams;
  }

  public async uploadActivities(files: File[]): Promise<{
    uploadedCount: number;
    skippedCount: number;
  }> {
    if (!files || files.length === 0) {
      return { uploadedCount: 0, skippedCount: 0 };
    }

    await this.ensureDefaultContainers();
    await this.writeCurrentSettingsToPod();
    await this.ensureAggregatorInitialized();

    const base = this.solidConnectorInfoService.fetch().base;
    if (!base) {
      throw new Error("Solid WebID is not configured.");
    }

    let uploadedCount = 0;
    let skippedCount = 0;
    for (const file of files) {
      const extension = this.getSupportedExtension(file.name);
      if (!extension) {
        skippedCount++;
        continue;
      }

      const activityIri = `${base}${SolidConnectorService.RAW_ACTIVITY_CONTAINER_PATH}${this.buildUploadFileName(
        file.name,
        extension
      )}`;

      const contentType = extension === "gpx" ? "application/gpx+xml" : "application/vnd.ant.fit";
      const response = await this.fetchWithAccessTokenFirst(activityIri, {
        method: "PUT",
        headers: {
          "Content-Type": contentType
        },
        body: await file.arrayBuffer()
      });

      if (!response.ok) {
        throw new Error(`Failed to upload activity ${file.name}: ${response.status} ${response.statusText}`);
      }

      uploadedCount++;
    }

    return { uploadedCount, skippedCount };
  }

  public waitForAggregatedActivityLocations(expectedNewCount: number): Promise<string[]> {
    if (expectedNewCount <= 0) {
      return Promise.resolve([]);
    }

    return this.activityDao.pollForNewActivityLocations(
      expectedNewCount,
      SolidConnectorService.AGGREGATED_ACTIVITY_POLL_TIMEOUT_MS,
      SolidConnectorService.AGGREGATED_ACTIVITY_POLL_INTERVAL_MS
    );
  }

  public async completePendingAggregatorAuthorizationFromRedirect(): Promise<string | null> {
    if (typeof sessionStorage === "undefined") {
      return null;
    }
    const pendingValue = sessionStorage.getItem(SolidConnectorService.PENDING_AGGREGATOR_AUTH_KEY);
    if (!pendingValue) {
      return null;
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return null;
    }

    const pending = JSON.parse(pendingValue) as { aggregatorBaseUrl: string; redirectUri: string; state: string };
    if (state !== pending.state) {
      return null;
    }

    const aggregatorUrl = await this.finishAggregatorAuthorization(
      pending.aggregatorBaseUrl,
      code,
      state,
      pending.redirectUri
    );
    sessionStorage.removeItem(SolidConnectorService.PENDING_AGGREGATOR_AUTH_KEY);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState({}, document.title, url.toString());
    return aggregatorUrl;
  }

  public async ensureAggregatorInitialized(): Promise<SolidConnectorInfo> {
    const solidConnectorInfo = this.solidConnectorInfoService.fetch();
    const aggregatorBaseUrl = this.normalizeAggregatorBaseUrl(solidConnectorInfo.aggregatorBaseUrl);

    if (!aggregatorBaseUrl) {
      throw new Error("Aggregator server URL is required.");
    }
    if (!solidConnectorInfo.issuer) {
      throw new Error("Solid issuer is required before initializing the aggregator.");
    }
    if (!solidConnectorInfo.base) {
      throw new Error("Selected athlete is required before initializing the aggregator.");
    }

    const existing = await this.findAggregatorInstance(aggregatorBaseUrl, solidConnectorInfo.aggregatorUrl);
    if (existing) {
      const saved = this.saveAggregatorInfo(aggregatorBaseUrl, existing);
      await this.writeCurrentSettingsToPod();
      return saved;
    }

    const authorizationStart = await this.startAggregatorAuthorization(aggregatorBaseUrl, solidConnectorInfo);
    if (this.getCurrentRedirectUri().startsWith("file:")) {
      const result = await this.desktopAggregatorLogin(authorizationStart.authorizationUrl);
      if (result.code && result.state) {
        const aggregatorUrl = await this.finishAggregatorAuthorization(
          aggregatorBaseUrl,
          result.code,
          result.state,
          authorizationStart.redirectUri
        );
        const saved = this.saveAggregatorInfo(aggregatorBaseUrl, aggregatorUrl);
        await this.writeCurrentSettingsToPod();
        return saved;
      }
    } else {
      await this.electronService.openExternalUrl(authorizationStart.authorizationUrl);
    }

    const initialized = await this.waitForAggregatorInstance(aggregatorBaseUrl);
    if (!initialized) {
      throw new Error("Aggregator login was started. Complete it in the browser, then retry sync.");
    }

    const saved = this.saveAggregatorInfo(aggregatorBaseUrl, initialized);
    await this.writeCurrentSettingsToPod();
    return saved;
  }

  private async ensureDefaultContainers(): Promise<void> {
    const base = this.solidConnectorInfoService.fetch().base;
    const loggedInBase = this.getLoggedInBase();
    if (!base && !loggedInBase) {
      return;
    }

    if (base) {
      await this.ensureContainerExists(`${base}/activities/`);
      await this.ensureContainerExists(`${base}/raw-activities/`);
      await this.ensureContainerExists(`${base}/settings/`);
    }
    if (loggedInBase && loggedInBase !== base) {
      await this.ensureContainerExists(`${loggedInBase}/settings/`);
    }
  }

  private async writeCurrentSettingsToPod(): Promise<void> {
    const base = this.solidConnectorInfoService.fetch().base;
    const loggedInBase = this.getLoggedInBase();
    if (!base && !loggedInBase) {
      return;
    }

    const [athleteModel, userSettings] = await Promise.all([
      this.athleteService.fetch(),
      this.userSettingsService.fetch()
    ]);

    await Promise.all(
      [
        base
          ? this.putTurtleIfMissing(
              `${base}/settings/elevate-athlete.ttl`,
              this.serializeAthleteModelAsTurtle(athleteModel)
            )
          : null,
        loggedInBase
          ? this.putTurtleIfMissing(
              `${loggedInBase}/settings/elevate-user.ttl`,
              this.serializeUserSettingsAsTurtle(userSettings)
            )
          : null
      ].filter(Boolean)
    );
  }

  private async putTurtleIfMissing(resourceIri: string, turtle: string): Promise<void> {
    const existing = await this.fetchWithAccessTokenFirst(resourceIri, {
      headers: { Accept: "text/turtle" }
    });
    if (existing.ok) {
      console.info("[SolidConnectorService] Solid settings resource already exists, skipping PUT", { resourceIri });
      return;
    }
    if (existing.status !== 404) {
      throw new Error(`Failed to check Solid settings ${resourceIri}: ${existing.status} ${existing.statusText}`);
    }

    const response = await this.fetchWithAccessTokenFirst(resourceIri, {
      method: "PUT",
      headers: {
        "Content-Type": "text/turtle"
      },
      body: turtle
    });

    if (!response.ok) {
      throw new Error(`Failed to write Solid settings ${resourceIri}: ${response.status} ${response.statusText}`);
    }
  }

  private getLoggedInBase(): string {
    const solidConnectorInfo = this.solidConnectorInfoService.fetch();
    return SolidConnectorInfo.webIdToBase(this.auth.webId || solidConnectorInfo.webId);
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
        throw new Error(`Failed to create Solid container at ${containerIri}: ${status} ${statusText}`);
      }

      await this.sleep(SolidConnectorService.CONTAINER_CREATION_RETRY_DELAY_MS);
    }
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationMs));
  }

  private async fetchWithAccessTokenFirst(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const method = (init.method || "GET").toUpperCase();
    const target = this.resolveRequestTarget(input);
    try {
      const response = await this.authFetch(input, init);
      if (this.shouldLogRequest(target)) {
        const outcome = response.ok ? "success" : "failure";
        const logFn = response.ok ? console.info : console.warn;
        logFn(`[SolidConnectorService] ${method} ${target} -> ${response.status} ${response.statusText} (${outcome})`);
      }
      if (response.status === 401) {
        this.rememberUmaAccessRequestUrl(target, response);
        if (await this.requestAccessOnUnauthorized(target, method, response)) {
          return this.authFetch(input, init);
        }
      }
      return response;
    } catch (error) {
      if (this.shouldLogRequest(target)) {
        console.error(`[SolidConnectorService] ${method} ${target} -> request error`, error);
      }
      if (this.isUmaAuthorizationError(error)) {
        this.logUmaAuthorizationError(target, method, error);
        if (await this.requestAccessOnUnauthorized(target, method)) {
          return this.authFetch(input, init);
        }
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
    return target.includes("/activities/") || target.includes("/raw-activities/") || target.includes("/settings/");
  }

  private async requestAccessOnUnauthorized(
    target: string,
    method: string,
    response?: Response,
    waitForAccess = true
  ): Promise<boolean> {
    const requestedActions = this.accessActionsForTarget(target, method);
    const actionsToRequest = requestedActions.filter(
      action => !this.requestedAccessKeys.has(this.accessRequestKey(target, action))
    );
    if (actionsToRequest.length === 0) {
      return waitForAccess ? this.waitForUmaAccess(target, method) : false;
    }

    const solidConnectorInfo = this.solidConnectorInfoService.fetch();
    const requestingParty = this.auth.webId || solidConnectorInfo.authSession?.webId || solidConnectorInfo.webId;
    const resolvedAccessRequestUrl =
      this.umaAccessRequestUrlByTarget.get(target) ||
      this.lastUmaAccessRequestUrl ||
      (await this.discoverUmaAccessRequestUrlForTarget(target));
    console.info("[SolidConnectorService] Preparing UMA access request", {
      target,
      method,
      hasResponse: Boolean(response),
      wwwAuthenticate: response?.headers?.get("WWW-Authenticate") || null,
      cachedAccessRequestUrl: this.umaAccessRequestUrlByTarget.get(target) || null,
      lastUmaAccessRequestUrl: this.lastUmaAccessRequestUrl,
      resolvedAccessRequestUrl,
      hasRequestingParty: Boolean(requestingParty)
    });
    if (!resolvedAccessRequestUrl) {
      console.warn("[SolidConnectorService] UMA access request URL is unavailable after probing target", {
        target,
        method
      });
      return false;
    }

    try {
      actionsToRequest.forEach(action => this.requestedAccessKeys.add(this.accessRequestKey(target, action)));
      const requested = await this.submitSeparateUmaAccessRequests(
        target,
        actionsToRequest,
        requestingParty,
        resolvedAccessRequestUrl,
        response
      );

      if (requested) {
        console.info(
          `[SolidConnectorService] UMA access request submitted for ${target} at ${resolvedAccessRequestUrl}`
        );
        return waitForAccess ? this.waitForUmaAccess(target, method) : false;
      } else {
        console.warn(`[SolidConnectorService] UMA access request was not submitted for ${target}.`);
        return false;
      }
    } catch (error) {
      console.warn(`[SolidConnectorService] Unable to submit UMA access request for ${target}.`, error);
      return false;
    }
  }

  private async submitSeparateUmaAccessRequests(
    target: string,
    requestedActions: UmaRequestedAction[],
    requestingParty: string | null,
    accessRequestUrl: string,
    response?: Response
  ): Promise<boolean> {
    let submitted = true;
    for (const requestedAction of Array.from(new Set(requestedActions))) {
      const result = await UmaAccessRequest.request({
        fetch: typeof window !== "undefined" && typeof window.fetch === "function" ? window.fetch.bind(window) : fetch,
        requestingParty,
        requestedTarget: target,
        requestedAction,
        response,
        accessRequestUrl
      });
      if (result.requested) {
        console.info("[SolidConnectorService] Submitted UMA access request", {
          target,
          requestedAction,
          accessRequestUrl: result.accessRequestUrl
        });
      } else {
        submitted = false;
        console.warn("[SolidConnectorService] UMA access request was not submitted", {
          target,
          requestedAction,
          reason: result.reason
        });
      }
    }
    return submitted;
  }

  private accessActionsForTarget(target: string, method: string): UmaRequestedAction[] {
    switch ((method || "GET").toUpperCase()) {
      case "DELETE":
        return ["delete"];
      case "POST":
        return ["create"];
      case "PUT":
        return target.endsWith("/") ? ["create"] : ["write"];
      case "PATCH":
        return ["write"];
      default:
        return ["read"];
    }
  }

  private accessRequestKey(target: string, requestedAction: UmaRequestedAction): string {
    return `${requestedAction} ${target}`;
  }

  private async waitForUmaAccess(target: string, method: string): Promise<boolean> {
    for (let attempt = 1; attempt <= SolidConnectorService.AGGREGATOR_POLL_ATTEMPTS; attempt++) {
      await this.sleep(SolidConnectorService.AGGREGATOR_ACCESS_POLL_DELAY_MS);
      try {
        const response = await this.authFetch(target, {
          method: method === "GET" || method === "HEAD" ? method : "HEAD"
        });
        console.info("[SolidConnectorService] Polled UMA access", {
          target,
          method,
          attempt,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok
        });
        if (response.ok) {
          return true;
        }
        if (response.status === 401) {
          this.rememberUmaAccessRequestUrl(target, response);
        }
      } catch (error) {
        console.info("[SolidConnectorService] UMA access poll still unauthorized", {
          target,
          method,
          attempt,
          error
        });
      }
    }

    console.warn("[SolidConnectorService] Timed out waiting for UMA access", {
      target,
      method,
      attempts: SolidConnectorService.AGGREGATOR_POLL_ATTEMPTS
    });
    return false;
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

  private logUmaAuthorizationError(target: string, method: string, error: unknown): void {
    const authorizationError = error as { name?: string; message?: string; status?: number; payload?: unknown };
    console.warn("[SolidConnectorService] UMA authorization error details", {
      target,
      method,
      name: authorizationError?.name || null,
      message: authorizationError?.message || null,
      status: authorizationError?.status || null,
      payload: authorizationError?.payload || null,
      cachedAccessRequestUrl: this.umaAccessRequestUrlByTarget.get(target) || null,
      lastUmaAccessRequestUrl: this.lastUmaAccessRequestUrl
    });
  }

  private getSupportedExtension(fileName: string): "fit" | "gpx" | null {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".fit")) {
      return "fit";
    }
    if (lower.endsWith(".gpx")) {
      return "gpx";
    }
    return null;
  }

  private getActivityFileType(value: string | null): ActivityFileType | null {
    const lower = (value || "").toLowerCase();
    if (lower.endsWith(".fit") || lower === ActivityFileType.FIT) {
      return ActivityFileType.FIT;
    }
    if (lower.endsWith(".gpx") || lower === ActivityFileType.GPX) {
      return ActivityFileType.GPX;
    }
    if (lower.endsWith(".tcx") || lower === ActivityFileType.TCX) {
      return ActivityFileType.TCX;
    }
    return null;
  }

  private async getRawActivityBuffer(rawActivityPath: string): Promise<ArrayBuffer | null> {
    const cached = this.rawActivityCache.get(rawActivityPath);
    if (cached) {
      this.rawActivityCache.delete(rawActivityPath);
      this.rawActivityCache.set(rawActivityPath, cached);
      console.info("[SolidStreamsTiming] raw activity cache hit", {
        rawActivityPath,
        byteLength: cached.byteLength
      });
      return cached;
    }

    const fetchStartedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchWithAccessTokenFirst(rawActivityPath);
    } catch (error) {
      if (this.isUmaAuthorizationError(error)) {
        console.warn("[SolidStreamsTiming] raw Solid activity is still inaccessible after UMA access request", {
          rawActivityPath,
          error
        });
        return null;
      }
      throw error;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.warn("[SolidStreamsTiming] raw Solid activity is inaccessible, skipping stream compute", {
          rawActivityPath,
          status: response.status,
          statusText: response.statusText
        });
        return null;
      }
      throw new Error(
        `Failed to fetch raw Solid activity ${rawActivityPath}: ${response.status} ${response.statusText}`
      );
    }

    const rawActivityBuffer = await response.arrayBuffer();
    console.info("[SolidStreamsTiming] raw activity fetched from pod", {
      rawActivityPath,
      elapsedMs: Date.now() - fetchStartedAt,
      byteLength: rawActivityBuffer.byteLength
    });
    this.rawActivityCache.set(rawActivityPath, rawActivityBuffer);
    while (this.rawActivityCache.size > SolidConnectorService.RAW_ACTIVITY_CACHE_SIZE) {
      const leastRecentlyUsedKey = this.rawActivityCache.keys().next().value;
      this.rawActivityCache.delete(leastRecentlyUsedKey);
    }
    return rawActivityBuffer;
  }

  private buildUploadFileName(fileName: string, extension: "fit" | "gpx"): string {
    const stem = fileName.replace(/\.[^/.]+$/, "");
    const normalizedStem = stem
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const safeStem = normalizedStem.length > 0 ? normalizedStem : "activity";
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${uniqueSuffix}-${safeStem}.${extension}`;
  }

  private syncConnectorInfoWithCurrentAuthSession(): SolidConnectorInfo {
    const solidConnectorInfo = this.solidConnectorInfoService.fetch();
    const updatedConnectorInfo = this.selectLoggedInAthlete(
      new SolidConnectorInfo(
        this.auth.webId || solidConnectorInfo.webId,
        solidConnectorInfo.issuer,
        solidConnectorInfo.clientId,
        this.buildCurrentAuthSession(solidConnectorInfo),
        null,
        solidConnectorInfo.aggregatorBaseUrl,
        solidConnectorInfo.aggregatorUrl,
        solidConnectorInfo.followingAthleteWebIds,
        solidConnectorInfo.selectedAthleteWebIds
      ),
      false
    );
    return updatedConnectorInfo;
  }

  private selectLoggedInAthlete(
    solidConnectorInfo: SolidConnectorInfo,
    forceSelection: boolean = true
  ): SolidConnectorInfo {
    const webId = this.auth.webId || solidConnectorInfo.authSession?.webId || solidConnectorInfo.webId;
    const followingAthleteWebIds = webId
      ? SolidConnectorInfo.normalizeWebIds([...solidConnectorInfo.followingAthleteWebIds, webId])
      : solidConnectorInfo.followingAthleteWebIds;
    const selectedAthleteWebIds =
      forceSelection || solidConnectorInfo.selectedAthleteWebIds.length === 0
        ? webId
          ? [webId]
          : []
        : solidConnectorInfo.selectedAthleteWebIds;

    return this.solidConnectorInfoService.save(
      new SolidConnectorInfo(
        webId || solidConnectorInfo.webId,
        solidConnectorInfo.issuer,
        solidConnectorInfo.clientId,
        solidConnectorInfo.authSession,
        null,
        solidConnectorInfo.aggregatorBaseUrl,
        solidConnectorInfo.aggregatorUrl,
        followingAthleteWebIds,
        selectedAthleteWebIds
      )
    );
  }

  private async restoreConnectorPreferencesFromPod(): Promise<SolidConnectorInfo | null> {
    const current = this.solidConnectorInfoService.fetch();
    const loggedInBase = this.getLoggedInBase();
    if (!loggedInBase) {
      return null;
    }

    const settingsIri = `${loggedInBase}/settings/elevate-user.ttl`;
    const response = await this.fetchWithAccessTokenFirst(settingsIri, { headers: { Accept: "text/turtle" } });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to read Solid user settings ${settingsIri}: ${response.status} ${response.statusText}`);
    }

    const preferences = await this.parseConnectorPreferencesFromUserSettings(await response.text(), settingsIri);
    const webId = this.auth.webId || current.webId;
    const followingAthleteWebIds = SolidConnectorInfo.normalizeWebIds([
      ...current.followingAthleteWebIds,
      ...preferences.followingAthleteWebIds,
      ...(webId ? [webId] : [])
    ]);

    return this.solidConnectorInfoService.save(
      new SolidConnectorInfo(
        webId,
        current.issuer,
        current.clientId,
        current.authSession,
        null,
        current.aggregatorBaseUrl,
        preferences.aggregatorUrl,
        followingAthleteWebIds,
        webId ? [webId] : []
      )
    );
  }

  private parseConnectorPreferencesFromUserSettings(
    turtle: string,
    settingsIri: string
  ): Promise<{ followingAthleteWebIds: string[]; aggregatorUrl: string | null }> {
    const store = new Store();
    const parser = new Parser({ baseIRI: settingsIri, format: "text/turtle" });

    return new Promise((resolve, reject) => {
      parser.parse(turtle, (error, quad) => {
        if (error) {
          reject(error);
          return;
        }
        if (quad) {
          store.addQuad(quad);
          return;
        }

        const userSettingsNode = DataFactory.namedNode(new URL("#user-settings", settingsIri).toString());
        const settingsPrefix = "https://solidlabresearch.github.io/elevate/settings#";
        const followingAthleteWebIds = store
          .getQuads(userSettingsNode, DataFactory.namedNode(`${settingsPrefix}followingAthleteWebId`), null, null)
          .map(quad => quad.object.value);
        const aggregatorUrl =
          store.getQuads(userSettingsNode, DataFactory.namedNode(`${settingsPrefix}aggregatorUrl`), null, null)[0]
            ?.object.value || null;

        resolve({
          followingAthleteWebIds: SolidConnectorInfo.normalizeWebIds(followingAthleteWebIds),
          aggregatorUrl: aggregatorUrl?.trim() || null
        });
      });
    });
  }

  private buildCurrentAuthSession(solidConnectorInfo: SolidConnectorInfo): SolidAuthSession | null {
    if (!this.auth.oidcAccessToken && !this.auth.oidcToken && !this.auth.oidcRefreshToken) {
      return null;
    }

    return {
      accessToken: this.auth.oidcAccessToken || null,
      idToken: this.auth.oidcToken || null,
      refreshToken: this.auth.oidcRefreshToken || null,
      expiresAt: this.auth.oidcTokenExpiry || null,
      webId: this.auth.webId || solidConnectorInfo.webId || null,
      issuer: solidConnectorInfo.issuer || null,
      clientId: solidConnectorInfo.clientId || SolidConnectorInfo.DEFAULT_CLIENT_ID_URL,
      redirectUri: this.getCurrentRedirectUri()
    };
  }

  private async findAggregatorInstance(
    aggregatorBaseUrl: string,
    preferredAggregatorUrl: string | null
  ): Promise<string | null> {
    if (preferredAggregatorUrl) {
      try {
        const response = await this.fetchAggregatorWithAccessRetry(preferredAggregatorUrl, {
          headers: { Accept: "application/json" }
        });
        if (response.ok) {
          return preferredAggregatorUrl;
        }
      } catch (_error) {
        // Fall back to listing below.
      }
    }

    const response = await this.fetchAggregatorWithAccessRetry(`${aggregatorBaseUrl}/registration`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`Aggregator server is not reachable at ${aggregatorBaseUrl}: ${response.status}`);
    }

    const aggregators = (await response.json()) as string[];
    return Array.isArray(aggregators) && aggregators.length > 0 ? aggregators[0] : null;
  }

  private async startAggregatorAuthorization(
    aggregatorBaseUrl: string,
    solidConnectorInfo: SolidConnectorInfo
  ): Promise<{ authorizationUrl: string; redirectUri: string }> {
    const base = solidConnectorInfo.base;
    const loggedInBase = this.getLoggedInBase() || base;
    const authorizationServer = await this.discoverAggregatorAuthorizationServer(solidConnectorInfo);
    const authorizationHeader = solidConnectorInfo.authSession?.accessToken
      ? { Authorization: `Bearer ${solidConnectorInfo.authSession.accessToken}` }
      : {};
    const response = await fetch(`${aggregatorBaseUrl}/registration`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...authorizationHeader
      },
      body: JSON.stringify({
        management_flow: "authorization_code",
        authorization_server: authorizationServer,
        issuer: solidConnectorInfo.issuer,
        source_container: `${base}/raw-activities/`,
        output_container: `${base}/activities/`,
        athlete_settings: `${base}/settings/elevate-athlete.ttl`,
        user_settings: `${loggedInBase}/settings/elevate-user.ttl`,
        return_url: this.getAggregatorReturnUrl()
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to start aggregator login: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as AggregatorRegistrationStartResponse;
    if (!body.aggregator_client_id || !body.code_challenge || !body.code_challenge_method || !body.state) {
      throw new Error("Aggregator did not return the required authorization_code flow parameters.");
    }
    const redirectUri = body.redirect_uri || this.getAggregatorReturnUrl();
    const authorizationEndpoint =
      body.authorization_endpoint || (await this.discoverOidcAuthorizationEndpoint(solidConnectorInfo.issuer));
    const authorizationUrl = new URL(authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", body.aggregator_client_id);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", "openid webid offline_access");
    authorizationUrl.searchParams.set("state", body.state);
    authorizationUrl.searchParams.set("code_challenge", body.code_challenge);
    authorizationUrl.searchParams.set("code_challenge_method", body.code_challenge_method);
    authorizationUrl.searchParams.set("prompt", "consent");
    authorizationUrl.searchParams.set("response_mode", "query");
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(
        SolidConnectorService.PENDING_AGGREGATOR_AUTH_KEY,
        JSON.stringify({
          aggregatorBaseUrl,
          redirectUri,
          state: body.state
        })
      );
    }
    return { authorizationUrl: authorizationUrl.toString(), redirectUri };
  }

  private async finishAggregatorAuthorization(
    aggregatorBaseUrl: string,
    code: string,
    state: string,
    redirectUri: string
  ): Promise<string> {
    const response = await fetch(`${aggregatorBaseUrl}/registration`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        management_flow: "authorization_code",
        code,
        redirect_uri: redirectUri,
        state
      })
    });
    if (!response.ok) {
      throw new Error(`Failed to finish aggregator login: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as { aggregator?: string };
    if (!body.aggregator) {
      throw new Error("Aggregator did not return an aggregator URL.");
    }
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(SolidConnectorService.PENDING_AGGREGATOR_AUTH_KEY);
    }
    return body.aggregator;
  }

  private async discoverOidcAuthorizationEndpoint(issuer: string | null): Promise<string> {
    if (!issuer) {
      throw new Error("Solid issuer is required before initializing the aggregator.");
    }
    const response = await fetch(`${issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`Failed to discover Solid issuer ${issuer}: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as { authorization_endpoint?: string };
    if (!body.authorization_endpoint) {
      throw new Error("Solid issuer did not advertise an authorization_endpoint.");
    }
    return body.authorization_endpoint;
  }

  private async discoverAggregatorAuthorizationServer(solidConnectorInfo: SolidConnectorInfo): Promise<string> {
    const webId = this.auth.webId || solidConnectorInfo.authSession?.webId || solidConnectorInfo.webId;
    if (!webId) {
      throw new Error("Logged-in WebID is required before initializing the aggregator.");
    }

    const candidateResources = [
      webId,
      solidConnectorInfo.base,
      `${solidConnectorInfo.base}/raw-activities/`,
      `${solidConnectorInfo.base}/activities/`,
      `${solidConnectorInfo.base}/settings/`
    ].filter(Boolean);

    for (const resource of candidateResources) {
      const authorizationServer = await this.discoverAuthorizationServerFromResource(resource);
      if (authorizationServer) {
        return authorizationServer;
      }
    }

    throw new Error(
      `Could not discover an UMA authorization server from the logged-in WebID or known protected resources for ${webId}.`
    );
  }

  private async discoverAuthorizationServerFromResource(resource: string): Promise<string | null> {
    const response = await fetch(resource, {
      method: "GET",
      headers: { Accept: "text/turtle, application/ld+json;q=0.8" }
    });
    const authorizationServer = this.parseUmaAuthorizationServer(response.headers.get("WWW-Authenticate"));
    if (!authorizationServer) {
      return null;
    }
    return authorizationServer.replace(/\/+$/u, "");
  }

  private parseUmaAuthorizationServer(header: string | null): string | null {
    console.info("[SolidConnectorService] Parsing UMA authorization server", {
      wwwAuthenticate: header
    });
    if (!header) {
      return null;
    }

    const umaIndex = header.toLowerCase().indexOf("uma");
    if (umaIndex < 0) {
      return null;
    }

    const match = /(as_uri|authorization_uri|issuer)=("[^"]*"|[^\s,]+)/u.exec(header.slice(umaIndex));
    if (!match) {
      return null;
    }

    const rawValue = match[2];
    return rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;
  }

  private rememberUmaAccessRequestUrl(target: string, response: Response): void {
    const wwwAuthenticate = response.headers.get("WWW-Authenticate");
    const authorizationServer = this.parseUmaAuthorizationServer(wwwAuthenticate);
    const accessRequestUrl = UmaAccessRequest.accessRequestUrlFromAuthorizationServer(authorizationServer);
    console.info("[SolidConnectorService] Parsed UMA challenge for access request URL", {
      target,
      status: response.status,
      wwwAuthenticate,
      authorizationServer,
      accessRequestUrl
    });
    if (accessRequestUrl) {
      this.umaAccessRequestUrlByTarget.set(target, accessRequestUrl);
      this.lastUmaAccessRequestUrl = accessRequestUrl;
    } else {
      console.warn("[SolidConnectorService] Could not derive UMA access request URL", {
        target,
        authorizationServer
      });
    }
  }

  private async discoverUmaAccessRequestUrlForTarget(target: string): Promise<string | null> {
    try {
      const probeResponse = await fetch(target, {
        method: "GET",
        headers: { Accept: "text/turtle, application/ld+json;q=0.8" }
      });
      const wwwAuthenticate = probeResponse.headers.get("WWW-Authenticate");
      const authorizationServer = this.parseUmaAuthorizationServer(wwwAuthenticate);
      const accessRequestUrl = UmaAccessRequest.accessRequestUrlFromAuthorizationServer(authorizationServer);
      console.info("[SolidConnectorService] Probed target for UMA access request URL", {
        target,
        status: probeResponse.status,
        statusText: probeResponse.statusText,
        wwwAuthenticate,
        authorizationServer,
        accessRequestUrl
      });
      if (accessRequestUrl) {
        this.umaAccessRequestUrlByTarget.set(target, accessRequestUrl);
        this.lastUmaAccessRequestUrl = accessRequestUrl;
      }
      return accessRequestUrl;
    } catch (error) {
      console.warn("[SolidConnectorService] Unable to probe target for UMA access request URL", {
        target,
        error
      });
      return null;
    }
  }

  private async desktopAggregatorLogin(authorizationUrl: string): Promise<SolidAggregatorAuthResult> {
    const ipcMessage = new IpcMessage(
      Channel.solidAggregatorLink,
      authorizationUrl,
      SolidConnectorService.DESKTOP_AGGREGATOR_RETURN_URL
    );
    return this.ipcTunnelService.send<IpcMessage, SolidAggregatorAuthResult>(ipcMessage);
  }

  private getAggregatorReturnUrl(): string {
    return this.getCurrentRedirectUri().startsWith("file:")
      ? SolidConnectorService.DESKTOP_AGGREGATOR_RETURN_URL
      : this.getCurrentRedirectUri();
  }

  private async waitForAggregatorInstance(aggregatorBaseUrl: string): Promise<string | null> {
    for (let attempt = 0; attempt < SolidConnectorService.AGGREGATOR_POLL_ATTEMPTS; attempt++) {
      await this.sleep(SolidConnectorService.AGGREGATOR_POLL_DELAY_MS);
      const aggregatorUrl = await this.findAggregatorInstance(aggregatorBaseUrl, null);
      if (aggregatorUrl) {
        return aggregatorUrl;
      }
    }
    return null;
  }

  private async fetchAggregatorWithAccessRetry(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const target = this.resolveRequestTarget(input);
    const method = (init.method || "GET").toUpperCase();
    let requestedAccess = false;

    for (let attempt = 0; attempt < SolidConnectorService.AGGREGATOR_POLL_ATTEMPTS; attempt++) {
      const response = await fetch(input, init);
      if (response.status !== 401) {
        return response;
      }

      if (!requestedAccess) {
        await this.requestAccessOnUnauthorized(target, method, response);
        requestedAccess = true;
      }

      await this.sleep(SolidConnectorService.AGGREGATOR_ACCESS_POLL_DELAY_MS);
    }

    return fetch(input, init);
  }

  private saveAggregatorInfo(aggregatorBaseUrl: string, aggregatorUrl: string): SolidConnectorInfo {
    const current = this.solidConnectorInfoService.fetch();
    return this.solidConnectorInfoService.save(
      new SolidConnectorInfo(
        current.webId,
        current.issuer,
        current.clientId,
        current.authSession,
        null,
        aggregatorBaseUrl,
        aggregatorUrl,
        current.followingAthleteWebIds,
        current.selectedAthleteWebIds
      )
    );
  }

  private normalizeAggregatorBaseUrl(aggregatorBaseUrl: string | null): string | null {
    const value = (aggregatorBaseUrl || "").trim();
    return value ? value.replace(/\/+$/g, "") : null;
  }

  private serializeAthleteModelAsTurtle(athleteModel: AthleteModel): string {
    const model = AthleteModel.asInstance(athleteModel || AthleteModel.DEFAULT_MODEL);
    const settings = model.datedAthleteSettings || AthleteModel.DEFAULT_MODEL.datedAthleteSettings;
    const datedSettingsLinks = settings.map((_, index) => `<#dated-athlete-settings-${index}>`).join(", ");
    return (
      this.settingsPrefixes() +
      `
<> a elset:AthleteSettingsDocument ;
  elset:athlete <#athlete> .

<#athlete> a elset:Athlete ;
  elset:gender ${this.ttlLiteral(model.gender)} ;
  elset:datedAthleteSettings ${datedSettingsLinks} .

${settings
  .map((datedSettings, index) =>
    this.serializeDatedAthleteSettings(
      `#dated-athlete-settings-${index}`,
      DatedAthleteSettings.asInstance(datedSettings)
    )
  )
  .join("\n\n")}
`
    );
  }

  private serializeDatedAthleteSettings(fragment: string, settings: DatedAthleteSettings): string {
    const triples = [
      settings.since ? `  elset:since ${this.ttlLiteral(settings.since, "xsd:date")}` : null,
      `  elset:maxHr ${this.ttlLiteral(settings.maxHr, "xsd:double")}`,
      `  elset:restHr ${this.ttlLiteral(settings.restHr, "xsd:double")}`,
      settings.lthr?.default !== null && settings.lthr?.default !== undefined
        ? `  elset:lthrDefault ${this.ttlLiteral(settings.lthr.default, "xsd:double")}`
        : null,
      settings.lthr?.cycling !== null && settings.lthr?.cycling !== undefined
        ? `  elset:lthrCycling ${this.ttlLiteral(settings.lthr.cycling, "xsd:double")}`
        : null,
      settings.lthr?.running !== null && settings.lthr?.running !== undefined
        ? `  elset:lthrRunning ${this.ttlLiteral(settings.lthr.running, "xsd:double")}`
        : null,
      settings.cyclingFtp !== null && settings.cyclingFtp !== undefined
        ? `  elset:cyclingFtp ${this.ttlLiteral(settings.cyclingFtp, "xsd:double")}`
        : null,
      settings.runningFtp !== null && settings.runningFtp !== undefined
        ? `  elset:runningFtp ${this.ttlLiteral(settings.runningFtp, "xsd:double")}`
        : null,
      settings.swimFtp !== null && settings.swimFtp !== undefined
        ? `  elset:swimFtp ${this.ttlLiteral(settings.swimFtp, "xsd:double")}`
        : null,
      `  elset:weight ${this.ttlLiteral(settings.weight, "xsd:double")}`
    ].filter(Boolean);

    return `<${fragment}> a elset:DatedAthleteSettings ;\n${triples
      .map((triple, index) => `${triple}${index === triples.length - 1 ? " ." : " ;"}`)
      .join("\n")}`;
  }

  private serializeUserSettingsAsTurtle(userSettings: UserSettings.BaseUserSettings): string {
    const settings = userSettings || UserSettings.DesktopUserSettings.DEFAULT_MODEL;
    const zones = settings.zones || UserZonesModel.DEFAULT_MODEL;
    const zoneKeys = Object.keys(UserZonesModel.DEFAULT_MODEL);
    const connectorInfo = this.solidConnectorInfoService.fetch();
    const connectorPreferenceTriples = [
      ...connectorInfo.followingAthleteWebIds.map(webId => `elset:followingAthleteWebId ${this.ttlLiteral(webId)}`),
      connectorInfo.aggregatorUrl ? `elset:aggregatorUrl ${this.ttlLiteral(connectorInfo.aggregatorUrl)}` : null
    ].filter(Boolean);
    const connectorPreferenceText = connectorPreferenceTriples.length
      ? `${connectorPreferenceTriples.join(" ;\n  ")} ;\n  `
      : "";

    return (
      this.settingsPrefixes() +
      `
<> a elset:UserSettingsDocument ;
  elset:userSettings <#user-settings> .

<#user-settings> a elset:UserSettings ;
  elset:buildTarget ${this.ttlLiteral(settings.buildTarget, "xsd:integer")} ;
  elset:systemUnit ${this.ttlLiteral(settings.systemUnit)} ;
  elset:temperatureUnit ${this.ttlLiteral(settings.temperatureUnit)} ;
  elset:disableMissingStressScoresWarning ${this.ttlLiteral(
    !!settings.disableMissingStressScoresWarning,
    "xsd:boolean"
  )} ;
  elset:disableActivitiesNeedRecalculationWarning ${this.ttlLiteral(
    !!settings.disableActivitiesNeedRecalculationWarning,
    "xsd:boolean"
  )} ;
  ${connectorPreferenceText}
  ${zoneKeys.map(key => `elset:zoneSet ${this.serializeZoneSet(key, zones[key])}`).join(" ;\n  ")} .
`
    );
  }

  private serializeZoneSet(key: string, values: number[]): string {
    return `[ a elset:ZoneSet ; elset:zoneKey ${this.ttlLiteral(key)} ; elset:zoneValues ${this.ttlLiteral(
      (values || []).join(" ")
    )} ]`;
  }

  private ttlLiteral(value: string | number | boolean, datatype?: string): string {
    const escapedValue = String(value === undefined || value === null ? "" : value).replace(/"/g, '\\"');
    return datatype ? `"${escapedValue}"^^${datatype}` : `"${escapedValue}"`;
  }

  private settingsPrefixes(): string {
    return `@prefix elset: <https://solidlabresearch.github.io/elevate/settings#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

`;
  }
}
