import { app, BrowserWindow } from "electron";
import { inject, singleton } from "tsyringe";
import { createHash, randomBytes } from "crypto";
import pDefer from "p-defer";
import { HttpClient } from "../../clients/http.client";
import { Logger } from "../../logger";

interface OidcConfiguration {
  authorization_endpoint?: string;
  token_endpoint?: string;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface SolidAuthorizationResult {
  accessToken: string | null;
  idToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  webId: string | null;
  issuer: string;
  clientId: string;
  redirectUri: string;
}

export interface SolidAggregatorAuthorizationResult {
  aggregatorUrl: string | null;
  code?: string | null;
  state?: string | null;
  error?: string | null;
}

@singleton()
export class SolidAuthenticator {
  public static readonly AUTH_WINDOW_HEIGHT = 800;
  public static readonly AUTH_WINDOW_WIDTH = 520;
  public static readonly REDIRECT_URI = "http://127.0.0.1:53682/solid-auth-callback";
  public static readonly SCOPE = "openid webid offline_access";

  private authenticationWindow: Electron.BrowserWindow | null;

  constructor(
    @inject(HttpClient) private readonly httpClient: HttpClient,
    @inject(Logger) private readonly logger: Logger
  ) {
    this.authenticationWindow = null;
  }

  public async authorize(issuer: string, clientId: string): Promise<SolidAuthorizationResult> {
    const cleanedIssuer = issuer.trim().replace(/\/+$/u, "");
    const cleanedClientId = clientId.trim();

    this.logger.info(`Starting Solid authorization for issuer ${cleanedIssuer}.`);
    const oidcConfig = await this.getOidcConfig(cleanedIssuer);
    if (!oidcConfig.authorization_endpoint || !oidcConfig.token_endpoint) {
      throw new Error("OIDC issuer is missing authorization_endpoint or token_endpoint.");
    }

    const state = this.generateRandomString(16);
    const codeVerifier = this.generateRandomString(64);
    const codeChallenge = this.pkceChallenge(codeVerifier);

    const authorizeUrl = new URL(oidcConfig.authorization_endpoint);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", cleanedClientId);
    authorizeUrl.searchParams.set("redirect_uri", SolidAuthenticator.REDIRECT_URI);
    authorizeUrl.searchParams.set("scope", SolidAuthenticator.SCOPE);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("prompt", "consent");
    authorizeUrl.searchParams.set("response_mode", "query");

    const authorizationCode = await this.openAuthWindowAndWaitForCode(authorizeUrl.toString(), state);
    this.logger.info("Solid authorization callback captured. Exchanging authorization code for tokens.");
    const tokenResponse = await this.exchangeCodeForTokens(
      oidcConfig.token_endpoint,
      cleanedClientId,
      authorizationCode,
      codeVerifier
    );

    const webId = tokenResponse.id_token ? this.extractWebId(tokenResponse.id_token) : null;
    this.logger.info(`Solid token exchange completed for ${webId || "unknown WebID"}.`);
    return {
      accessToken: tokenResponse.access_token || null,
      idToken: tokenResponse.id_token || null,
      refreshToken: tokenResponse.refresh_token || null,
      expiresAt: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : null,
      webId,
      issuer: cleanedIssuer,
      clientId: cleanedClientId,
      redirectUri: SolidAuthenticator.REDIRECT_URI
    };
  }

  public async authorizeAggregator(
    authorizationUrl: string,
    returnUri: string
  ): Promise<SolidAggregatorAuthorizationResult> {
    return this.openAggregatorAuthWindowAndWaitForReturn(authorizationUrl, returnUri);
  }

  private async getOidcConfig(issuer: string): Promise<OidcConfiguration> {
    const wellKnownUrl = `${issuer}/.well-known/openid-configuration`;
    const response = await this.httpClient.get<OidcConfiguration>(wellKnownUrl);
    return response.data;
  }

  private async exchangeCodeForTokens(
    tokenEndpoint: string,
    clientId: string,
    authorizationCode: string,
    codeVerifier: string
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: SolidAuthenticator.REDIRECT_URI,
      client_id: clientId,
      code_verifier: codeVerifier
    }).toString();

    try {
      const response = await this.httpClient.post<TokenResponse>(tokenEndpoint, body, {
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        }
      });
      return response.data;
    } catch (error) {
      const status = (error as { response?: { status?: number; statusText?: string } }).response?.status;
      const statusText = (error as { response?: { statusText?: string } }).response?.statusText;
      const statusLabel = status ? `${status}${statusText ? ` ${statusText}` : ""}` : "request failed";
      const message = `Solid token request failed for ${tokenEndpoint}: ${statusLabel}.`;
      this.logger.error(message, error);
      throw new Error(message);
    }
  }

  private openAuthWindowAndWaitForCode(authorizeUrl: string, expectedState: string): Promise<string> {
    const deferred = pDefer<string>();

    if (this.authenticationWindow && !this.authenticationWindow.isDestroyed()) {
      this.authenticationWindow.close();
      this.authenticationWindow = null;
    }

    this.authenticationWindow = new BrowserWindow({
      height: SolidAuthenticator.AUTH_WINDOW_HEIGHT,
      width: SolidAuthenticator.AUTH_WINDOW_WIDTH,
      resizable: false,
      autoHideMenuBar: true,
      minimizable: false,
      title: null
    });

    const cleanup = () => {
      if (!this.authenticationWindow || this.authenticationWindow.isDestroyed()) {
        return;
      }
      this.authenticationWindow.webContents.removeListener("will-redirect", navigationListener);
      this.authenticationWindow.webContents.removeListener("will-navigate", navigationListener);
      this.authenticationWindow.webContents.removeListener("did-fail-load", failedLoadListener);
      this.authenticationWindow.removeListener("closed", closedListener);
    };

    const navigationListener = (event: Electron.Event, nextUrl: string) => {
      this.logger.info(`Solid auth window navigation: ${this.sanitizeUrlForLog(nextUrl)}.`);
      if (!nextUrl.startsWith(SolidAuthenticator.REDIRECT_URI)) {
        return;
      }

      event.preventDefault();
      const url = new URL(nextUrl);
      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      cleanup();

      if (this.authenticationWindow && !this.authenticationWindow.isDestroyed()) {
        this.authenticationWindow.close();
      }
      this.authenticationWindow = null;

      if (error) {
        deferred.reject(new Error(`Solid authorization failed: ${error}`));
        return;
      }
      if (state !== expectedState) {
        deferred.reject(new Error("Solid authorization failed: state mismatch."));
        return;
      }
      if (!code) {
        deferred.reject(new Error("Solid authorization failed: missing authorization code."));
        return;
      }

      deferred.resolve(code);
    };

    const closedListener = () => {
      cleanup();
      this.authenticationWindow = null;
      deferred.reject(new Error("Solid authorization window was closed."));
    };

    const failedLoadListener = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string
    ) => {
      this.logger.warn(
        `Solid auth window failed to load ${this.sanitizeUrlForLog(validatedURL)}: ${errorCode} ${errorDescription}.`
      );
    };

    this.authenticationWindow.webContents.on("will-redirect", navigationListener);
    this.authenticationWindow.webContents.on("will-navigate", navigationListener);
    this.authenticationWindow.webContents.on("did-fail-load", failedLoadListener);
    this.authenticationWindow.on("closed", closedListener);

    this.authenticationWindow.loadURL(authorizeUrl, {
      userAgent: app.userAgentFallback.replace(`Chrome/${process.versions.chrome}`, "Chrome")
    });

    this.authenticationWindow.webContents.on("did-finish-load", () => {
      if (this.authenticationWindow && !this.authenticationWindow.isDestroyed()) {
        this.authenticationWindow.show();
        this.authenticationWindow.focus();
      }
    });

    return deferred.promise;
  }

  private openAggregatorAuthWindowAndWaitForReturn(
    authorizeUrl: string,
    expectedReturnUri: string
  ): Promise<SolidAggregatorAuthorizationResult> {
    const deferred = pDefer<SolidAggregatorAuthorizationResult>();

    if (this.authenticationWindow && !this.authenticationWindow.isDestroyed()) {
      this.authenticationWindow.close();
      this.authenticationWindow = null;
    }

    this.authenticationWindow = new BrowserWindow({
      height: SolidAuthenticator.AUTH_WINDOW_HEIGHT,
      width: SolidAuthenticator.AUTH_WINDOW_WIDTH,
      resizable: false,
      autoHideMenuBar: true,
      minimizable: false,
      title: null
    });

    const cleanup = () => {
      if (!this.authenticationWindow || this.authenticationWindow.isDestroyed()) {
        return;
      }
      this.authenticationWindow.webContents.removeListener("will-redirect", navigationListener);
      this.authenticationWindow.webContents.removeListener("will-navigate", navigationListener);
      this.authenticationWindow.webContents.removeListener("did-fail-load", failedLoadListener);
      this.authenticationWindow.removeListener("closed", closedListener);
    };

    const navigationListener = (event: Electron.Event, nextUrl: string) => {
      this.logger.info(`Aggregator auth window navigation: ${this.sanitizeUrlForLog(nextUrl)}.`);
      if (!nextUrl.startsWith(expectedReturnUri)) {
        return;
      }

      event.preventDefault();
      const url = new URL(nextUrl);
      const error = url.searchParams.get("error");
      const aggregatorUrl = url.searchParams.get("aggregator");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      cleanup();

      if (this.authenticationWindow && !this.authenticationWindow.isDestroyed()) {
        this.authenticationWindow.close();
      }
      this.authenticationWindow = null;

      if (error) {
        deferred.reject(new Error(`Aggregator authorization failed: ${error}`));
        return;
      }
      if (!aggregatorUrl && (!code || !state)) {
        deferred.reject(new Error("Aggregator authorization failed: missing authorization code or aggregator URL."));
        return;
      }

      deferred.resolve({ aggregatorUrl, code, state });
    };

    const closedListener = () => {
      cleanup();
      this.authenticationWindow = null;
      deferred.reject(new Error("Aggregator authorization window was closed."));
    };

    const failedLoadListener = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string
    ) => {
      this.logger.warn(
        `Aggregator auth window failed to load ${this.sanitizeUrlForLog(
          validatedURL
        )}: ${errorCode} ${errorDescription}.`
      );
    };

    this.authenticationWindow.webContents.on("will-redirect", navigationListener);
    this.authenticationWindow.webContents.on("will-navigate", navigationListener);
    this.authenticationWindow.webContents.on("did-fail-load", failedLoadListener);
    this.authenticationWindow.on("closed", closedListener);

    this.authenticationWindow.loadURL(authorizeUrl, {
      userAgent: app.userAgentFallback.replace(`Chrome/${process.versions.chrome}`, "Chrome")
    });

    this.authenticationWindow.webContents.on("did-finish-load", () => {
      if (this.authenticationWindow && !this.authenticationWindow.isDestroyed()) {
        this.authenticationWindow.show();
        this.authenticationWindow.focus();
      }
    });

    return deferred.promise;
  }

  private generateRandomString(bytes: number): string {
    return randomBytes(bytes).toString("hex");
  }

  private pkceChallenge(codeVerifier: string): string {
    return createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/u, "");
  }

  private extractWebId(idToken: string): string | null {
    try {
      const tokenParts = idToken.split(".");
      if (tokenParts.length < 2) {
        return null;
      }

      const normalizedPayload = tokenParts[1].replace(/-/gu, "+").replace(/_/gu, "/");
      const payloadJson = Buffer.from(normalizedPayload, "base64").toString("utf8");
      const payload = JSON.parse(payloadJson);
      return payload.webid || payload.sub || null;
    } catch (error) {
      this.logger.warn("Unable to parse WebID from ID token.");
      return null;
    }
  }

  private sanitizeUrlForLog(value: string): string {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch (_error) {
      return value.split("?")[0];
    }
  }
}
