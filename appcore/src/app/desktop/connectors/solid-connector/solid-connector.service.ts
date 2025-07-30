import { Inject, Injectable } from "@angular/core";
import { DesktopSyncService } from "../../../shared/services/sync/impl/desktop-sync.service";
import { SyncService } from "../../../shared/services/sync/sync.service";
import { ConnectorService } from "../connector.service";
import { IPC_TUNNEL_SERVICE } from "../../ipc/ipc-tunnel-service.token";
import { IpcTunnelService } from "@elevate/shared/electron/ipc-tunnel";
import { ConnectorType } from "@elevate/shared/sync/connectors/connector-type.enum";
import { StravaConnectorInfo } from "@elevate/shared/sync/connectors/strava-connector-info.model";
import { SolidConnectorInfoService } from "../../../shared/services/solid-connector-info/solid-connector-info.service";
import { SolidConnectorInfo } from "@elevate/shared/sync/connectors/solid-connector-info.model";

@Injectable()
export class SolidConnectorService extends ConnectorService {
  constructor(
    @Inject(IPC_TUNNEL_SERVICE) public readonly ipcTunnelService: IpcTunnelService,
    @Inject(SolidConnectorInfoService) public readonly solidConnectorInfoService: SolidConnectorInfoService,
    @Inject(SyncService) private readonly desktopSyncService: DesktopSyncService
  ) {
    super();
  }

  public fetch(): Promise<SolidConnectorInfo> {
    return Promise.resolve(this.solidConnectorInfoService.fetch());
  }

  /**
   * Promise updated SolidConnectorInfo with proper access & refresh token
   */
  public authenticate(): Promise<StravaConnectorInfo> {
    let solidConnectorInfo: SolidConnectorInfo = null;

    throw new Error("not implemented yet");
  }

  /**
   *
   */
  public sync(): Promise<void> {
    return this.desktopSyncService.sync(null, null, ConnectorType.SOLID);
  }

  /**
   *
   */
  public stop(): Promise<void> {
    return this.desktopSyncService.stop();
  }
}
