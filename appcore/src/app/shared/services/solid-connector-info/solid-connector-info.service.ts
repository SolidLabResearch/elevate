import { Inject, Injectable } from "@angular/core";
import { CollectionDef } from "../../data-store/collection-def";
import { ElectronService } from "../../../desktop/electron/electron.service";
import { ConnectorSyncDateTimeDao } from "../../dao/sync/connector-sync-date-time.dao";
import { SolidConnectorInfo } from "@elevate/shared/sync/connectors/solid-connector-info.model";

@Injectable()
export class SolidConnectorInfoService {
  /**
   * Embedded DAO. No need to extend from BaseDao. We store in local storage instead of indexed db which might be synced in future
   */
  private static SolidConnectorInfoDao = class {
    private static readonly COLLECTION_DEF: CollectionDef<SolidConnectorInfo> = new CollectionDef(
      "SOLID_CONNECTOR_INFO",
      null
    );
    private static readonly DEFAULT_STORAGE_VALUE: SolidConnectorInfo = SolidConnectorInfo.DEFAULT_MODEL;

    public static fetch(): SolidConnectorInfo {
      const storedConnectorInfo = localStorage.getItem(
        SolidConnectorInfoService.SolidConnectorInfoDao.COLLECTION_DEF.name
      );
      const connectorInfo: SolidConnectorInfo = storedConnectorInfo ? JSON.parse(storedConnectorInfo) : null;
      if (connectorInfo) {
        return new SolidConnectorInfo(connectorInfo.webId);
      } else {
        return SolidConnectorInfoService.SolidConnectorInfoDao.DEFAULT_STORAGE_VALUE;
      }
    }

    public static save(solidConnectorInfo: SolidConnectorInfo): SolidConnectorInfo {
      localStorage.setItem(
        SolidConnectorInfoService.SolidConnectorInfoDao.COLLECTION_DEF.name,
        JSON.stringify(solidConnectorInfo)
      );
      return SolidConnectorInfoService.SolidConnectorInfoDao.fetch();
    }
  };

  constructor(
    @Inject(ConnectorSyncDateTimeDao) private readonly connectorSyncDateTimeDao: ConnectorSyncDateTimeDao,
    @Inject(ElectronService) private readonly electronService: ElectronService
  ) {}

  public fetch(): SolidConnectorInfo {
    return SolidConnectorInfoService.SolidConnectorInfoDao.fetch();
  }

  public save(solidConnectorInfo: SolidConnectorInfo): SolidConnectorInfo {
    return SolidConnectorInfoService.SolidConnectorInfoDao.save(solidConnectorInfo);
  }

  public getWebid(): string | null {
    const solidConnectorInfo = this.fetch();
    return solidConnectorInfo && solidConnectorInfo.webId ? solidConnectorInfo.webId : null;
  }
}
