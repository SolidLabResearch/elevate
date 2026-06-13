import { ConnectorInfo } from "./connector-info.model";

export interface SolidAuthSession {
  accessToken: string | null;
  idToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  webId: string | null;
  issuer: string | null;
  clientId: string | null;
  redirectUri: string | null;
}

export class SolidConnectorInfo extends ConnectorInfo {
  public static readonly DEFAULT_CLIENT_ID_URL = "https://solidlabresearch.github.io/elevate/client-id.jsonld";
  public static readonly DEFAULT_AGGREGATOR_BASE_URL = "http://localhost:4050";
  public static readonly DEFAULT_MODEL: SolidConnectorInfo = new SolidConnectorInfo(
    null,
    null,
    SolidConnectorInfo.DEFAULT_CLIENT_ID_URL,
    null,
    null,
    SolidConnectorInfo.DEFAULT_AGGREGATOR_BASE_URL,
    null,
    [],
    []
  );
  public readonly base: string;

  constructor(
    public webId: string | null,
    public issuer: string | null = null,
    public clientId: string | null = SolidConnectorInfo.DEFAULT_CLIENT_ID_URL,
    public authSession: SolidAuthSession | null = null,
    public dataWebId: string | null = null,
    public aggregatorBaseUrl: string | null = SolidConnectorInfo.DEFAULT_AGGREGATOR_BASE_URL,
    public aggregatorUrl: string | null = null,
    public followingAthleteWebIds: string[] = [],
    public selectedAthleteWebIds: string[] = []
  ) {
    super();
    this.webId = webId;
    this.issuer = issuer;
    this.clientId = clientId;
    this.authSession = authSession;
    this.dataWebId = dataWebId;
    this.aggregatorBaseUrl = aggregatorBaseUrl || SolidConnectorInfo.DEFAULT_AGGREGATOR_BASE_URL;
    this.aggregatorUrl = aggregatorUrl;
    this.followingAthleteWebIds = SolidConnectorInfo.normalizeWebIds(followingAthleteWebIds);
    this.selectedAthleteWebIds = SolidConnectorInfo.normalizeWebIds(selectedAthleteWebIds)
      .filter(webId => this.followingAthleteWebIds.includes(webId))
      .slice(0, 1);
    this.base = this.primaryDataWebId ? SolidConnectorInfo.webIdToBase(this.primaryDataWebId) : "";
  }

  public get primaryDataWebId(): string | null {
    return this.selectedAthleteWebIds[0] || null;
  }

  public get selectedBases(): string[] {
    return this.selectedAthleteWebIds.map(webId => SolidConnectorInfo.webIdToBase(webId)).filter(Boolean);
  }

  public static webIdToBase(webId: string | null): string {
    return webId ? webId.replace("/profile/card#me", "") : "";
  }

  public static normalizeWebIds(webIds: string[] = []): string[] {
    return Array.from(new Set((webIds || []).map(webId => webId?.trim()).filter(Boolean)));
  }
}
