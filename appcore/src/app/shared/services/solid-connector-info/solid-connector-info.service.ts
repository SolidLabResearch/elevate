import { Injectable } from "@angular/core";
import { SolidConnectorInfo } from "@elevate/shared/sync/connectors/solid-connector-info.model";

@Injectable()
export class SolidConnectorInfoService {
  public fetch(): SolidConnectorInfo {
    const storedConnectorInfo = localStorage.getItem("SOLID_CONNECTOR_INFO");
    const connectorInfo: SolidConnectorInfo = storedConnectorInfo ? JSON.parse(storedConnectorInfo) : null;
    if (connectorInfo) {
      const dataWebId = (connectorInfo as SolidConnectorInfo & { dataWebId?: string | null }).dataWebId;
      const migratedDataWebId = dataWebId === undefined ? connectorInfo.webId : dataWebId || null;
      const followingAthleteWebIds = SolidConnectorInfo.normalizeWebIds(
        (connectorInfo as SolidConnectorInfo & { followingAthleteWebIds?: string[] }).followingAthleteWebIds || []
      );
      const selectedAthleteWebIds = (connectorInfo as SolidConnectorInfo & { selectedAthleteWebIds?: string[] })
        .selectedAthleteWebIds;
      const migratedFollowingAthleteWebIds = migratedDataWebId
        ? SolidConnectorInfo.normalizeWebIds([...followingAthleteWebIds, migratedDataWebId])
        : followingAthleteWebIds;
      const normalizedSelectedAthleteWebIds = SolidConnectorInfo.normalizeWebIds(selectedAthleteWebIds || []);
      const migratedSelectedAthleteWebIds = normalizedSelectedAthleteWebIds.length
        ? normalizedSelectedAthleteWebIds
        : migratedDataWebId
        ? [migratedDataWebId]
        : [];

      return new SolidConnectorInfo(
        connectorInfo.webId,
        connectorInfo.issuer || null,
        connectorInfo.clientId || SolidConnectorInfo.DEFAULT_CLIENT_ID_URL,
        connectorInfo.authSession || null,
        migratedDataWebId,
        (connectorInfo as SolidConnectorInfo & { aggregatorBaseUrl?: string | null }).aggregatorBaseUrl ||
          SolidConnectorInfo.DEFAULT_AGGREGATOR_BASE_URL,
        (connectorInfo as SolidConnectorInfo & { aggregatorUrl?: string | null }).aggregatorUrl || null,
        migratedFollowingAthleteWebIds,
        migratedSelectedAthleteWebIds
      );
    } else {
      return SolidConnectorInfo.DEFAULT_MODEL;
    }
  }

  public save(solidConnectorInfo: SolidConnectorInfo): SolidConnectorInfo {
    localStorage.setItem("SOLID_CONNECTOR_INFO", JSON.stringify(solidConnectorInfo));
    return this.fetch();
  }

  public selectedAthleteWebIds(): string[] {
    return this.fetch().selectedAthleteWebIds;
  }

  public primarySelectedAthleteWebId(): string | null {
    return this.selectedAthleteWebIds()[0] || null;
  }

  public hasMultipleSelectedAthletes(): boolean {
    return this.selectedAthleteWebIds().length > 1;
  }

  public resetLoggedOutState(): SolidConnectorInfo {
    const current = this.fetch();
    return this.save(
      new SolidConnectorInfo(
        null,
        current.issuer,
        current.clientId,
        null,
        null,
        current.aggregatorBaseUrl,
        null,
        current.followingAthleteWebIds,
        []
      )
    );
  }
}
