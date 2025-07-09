import { ConnectorInfo } from "./connector-info.model";

export class SolidConnectorInfo extends ConnectorInfo {
  public static readonly DEFAULT_MODEL: SolidConnectorInfo = new SolidConnectorInfo(null);

  constructor(public webId: string | null) {
    super();
    this.webId = webId;
  }
}
