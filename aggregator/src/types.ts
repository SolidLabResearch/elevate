export interface TokenSet {
  accessToken: string;
  idToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}

export interface PendingAuthorization {
  state: string;
  issuer: string;
  authorizationServer: string | null;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  sourceContainer: string | null;
  outputContainer: string | null;
  athleteSettingsUrl: string | null;
  userSettingsUrl: string | null;
  returnUrl: string | null;
  createdAt: string;
}

export interface AggregatorInstance {
  id: string;
  url: string;
  createdAt: string;
  issuer: string;
  authorizationServer: string | null;
  authorizationServerClient: AuthorizationServerClientCredentials | null;
  webId: string | null;
  storageRoot: string | null;
  sourceContainer: string;
  outputContainer: string;
  athleteSettingsUrl: string;
  userSettingsUrl: string;
  tokenSet: TokenSet;
  processedSources: Record<string, string>;
  settingsSignature: string | null;
  webhookSecret: string;
  webhookSubscriptions: Partial<Record<WebhookTopicKind, WebhookSubscription>>;
  resourceRegistrations: Partial<Record<AggregatorResourceKind, string>>;
  lastExecution: ServiceExecution | null;
}

export type AggregatorResourceKind = "service-collection" | "service" | "service-output";

export interface AuthorizationServerClientCredentials {
  clientId: string;
  clientSecret: string;
}

export type WebhookTopicKind = "source" | "athlete-settings" | "user-settings";

export interface WebhookSubscription {
  topic: string;
  sendTo: string;
  channelId: string | null;
  sender: string | null;
  createdAt: string;
}

export interface ServiceExecution {
  id: string;
  source: string;
  output: string;
  startedAt: string;
  endedAt: string | null;
  status: "success" | "error";
  message?: string;
}
