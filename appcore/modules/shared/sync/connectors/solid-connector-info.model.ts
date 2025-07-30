import { ConnectorInfo } from "./connector-info.model";

export class SolidConnectorInfo extends ConnectorInfo {
  public static readonly DEFAULT_MODEL: SolidConnectorInfo = new SolidConnectorInfo(null);
  public readonly base: string;
  //public readonly token: string;

  constructor(public webId: string | null) {
    super();
    this.webId = webId;
    this.base = webId ? webId.replace("/profile/card#me", "") : "";
  }
}
