import { TestBed } from "@angular/core/testing";
import { SolidConnectorInfoService } from "./solid-connector-info.service";
import { CoreModule } from "../../../core/core.module";
import { SharedModule } from "../../shared.module";
import { TargetModule } from "../../modules/target/desktop-target.module";
import { DataStore } from "../../data-store/data-store";
import { TestingDataStore } from "../../data-store/testing-datastore.service";
import { IPC_TUNNEL_SERVICE } from "../../../desktop/ipc/ipc-tunnel-service.token";
import { IpcRendererTunnelServiceMock } from "../../../desktop/ipc/ipc-renderer-tunnel-service.mock";
import { SolidConnectorInfo } from "@elevate/shared/sync/connectors/solid-connector-info.model";

describe("SolidConnectorInfoService", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [CoreModule, SharedModule, TargetModule],
      providers: [
        { provide: DataStore, useClass: TestingDataStore },
        { provide: IPC_TUNNEL_SERVICE, useClass: IpcRendererTunnelServiceMock }
      ]
    })
  );

  afterEach(() => {
    localStorage.removeItem("SOLID_CONNECTOR_INFO");
  });

  it("should be created", () => {
    const service: SolidConnectorInfoService = TestBed.inject(SolidConnectorInfoService);
    expect(service).toBeTruthy();
  });

  it("should migrate legacy webId to dataWebId", () => {
    localStorage.setItem(
      "SOLID_CONNECTOR_INFO",
      JSON.stringify({
        webId: "https://login-user.example/profile/card#me",
        issuer: "https://broker.pod.example",
        clientId: SolidConnectorInfo.DEFAULT_CLIENT_ID_URL,
        authSession: null
      })
    );

    const service: SolidConnectorInfoService = TestBed.inject(SolidConnectorInfoService);
    const connectorInfo = service.fetch();

    expect(connectorInfo.webId).toBe("https://login-user.example/profile/card#me");
    expect(connectorInfo.dataWebId).toBe("https://login-user.example/profile/card#me");
    expect(connectorInfo.base).toBe("https://login-user.example");
  });

  it("should preserve separate auth and data webIds", () => {
    const service: SolidConnectorInfoService = TestBed.inject(SolidConnectorInfoService);

    service.save(
      new SolidConnectorInfo(
        "https://login-user.example/profile/card#me",
        "https://broker.pod.example",
        SolidConnectorInfo.DEFAULT_CLIENT_ID_URL,
        null,
        "https://data-user.example/profile/card#me"
      )
    );

    const connectorInfo = service.fetch();

    expect(connectorInfo.webId).toBe("https://login-user.example/profile/card#me");
    expect(connectorInfo.dataWebId).toBe("https://data-user.example/profile/card#me");
    expect(connectorInfo.base).toBe("https://data-user.example");
  });
});
