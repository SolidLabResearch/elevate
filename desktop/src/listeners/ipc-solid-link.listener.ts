import { IpcListener } from "./ipc-listener.interface";
import { inject, singleton } from "tsyringe";
import { IpcTunnelService } from "@elevate/shared/electron/ipc-tunnel";
import { Channel } from "@elevate/shared/electron/channels.enum";
import {
  SolidAggregatorAuthorizationResult,
  SolidAuthenticator,
  SolidAuthorizationResult
} from "../connectors/solid/solid-authenticator";

@singleton()
export class IpcSolidLinkListener implements IpcListener {
  constructor(@inject(SolidAuthenticator) private readonly solidAuthenticator: SolidAuthenticator) {}

  public startListening(ipcTunnelService: IpcTunnelService): void {
    ipcTunnelService.on<Array<[string, string]>, SolidAuthorizationResult>(Channel.solidLink, payload => {
      const [issuer, clientId] = payload[0];
      return this.solidAuthenticator.authorize(issuer, clientId);
    });
    ipcTunnelService.on<Array<[string, string]>, SolidAggregatorAuthorizationResult>(
      Channel.solidAggregatorLink,
      payload => {
        const [authorizationUrl, returnUri] = payload[0];
        return this.solidAuthenticator.authorizeAggregator(authorizationUrl, returnUri);
      }
    );
  }
}
