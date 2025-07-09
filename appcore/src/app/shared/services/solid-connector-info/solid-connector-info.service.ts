import { Injectable } from "@angular/core";
import { SolidConnectorInfo } from "@elevate/shared/sync/connectors/solid-connector-info.model";

@Injectable()
export class SolidConnectorInfoService {
  public fetch(): SolidConnectorInfo {
    const storedConnectorInfo = localStorage.getItem("SOLID_CONNECTOR_INFO");
    const connectorInfo: SolidConnectorInfo = storedConnectorInfo ? JSON.parse(storedConnectorInfo) : null;
    if (connectorInfo) {
      return new SolidConnectorInfo(connectorInfo.webId);
    } else {
      return SolidConnectorInfo.DEFAULT_MODEL;
    }
  }

  public save(solidConnectorInfo: SolidConnectorInfo): SolidConnectorInfo {
    localStorage.setItem("SOLID_CONNECTOR_INFO", JSON.stringify(solidConnectorInfo));
    return this.fetch();
  }
}
