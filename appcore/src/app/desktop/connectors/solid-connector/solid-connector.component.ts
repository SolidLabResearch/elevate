import { Component, Inject, OnDestroy, OnInit } from "@angular/core";
import { ConnectorsComponent } from "../connectors.component";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ElectronService } from "../../electron/electron.service";
import { DesktopSyncService } from "../../../shared/services/sync/impl/desktop-sync.service";
import { MatDialog } from "@angular/material/dialog";
import { Router } from "@angular/router";
import {
  OPEN_RESOURCE_RESOLVER,
  OpenResourceResolver
} from "../../../shared/services/links-opener/open-resource-resolver";
import { Subscription } from "rxjs";
import { SyncService } from "../../../shared/services/sync/sync.service";
import { AppService } from "../../../shared/services/app-service/app.service";
import { SolidConnectorService } from "./solid-connector.service";
import { SolidConnectorInfo } from "@elevate/shared/sync/connectors/solid-connector-info.model";
import { ConnectorType } from "@elevate/shared/sync/connectors/connector-type.enum";
import { SolidConnectorInfoService } from "../../../shared/services/solid-connector-info/solid-connector-info.service";

@Component({
  selector: "app-solid-connector",
  templateUrl: "./solid-connector.component.html",
  styleUrls: ["./solid-connector.component.scss"]
})
export class SolidConnectorComponent extends ConnectorsComponent implements OnInit, OnDestroy {
  public showConfigure: boolean;
  public solidConnectorInfo: SolidConnectorInfo;
  public historyChangesSub: Subscription;

  constructor(
    @Inject(AppService) public readonly appService: AppService,
    @Inject(SolidConnectorInfoService) protected readonly solidConnectorInfoService: SolidConnectorInfoService,
    @Inject(SyncService) protected readonly desktopSyncService: DesktopSyncService,
    @Inject(SolidConnectorService) protected readonly solidConnectorService: SolidConnectorService,
    @Inject(OPEN_RESOURCE_RESOLVER) protected readonly openResourceResolver: OpenResourceResolver,
    @Inject(ElectronService) protected readonly electronService: ElectronService,
    @Inject(Router) protected readonly router: Router,
    @Inject(MatSnackBar) protected readonly snackBar: MatSnackBar,
    @Inject(MatDialog) protected readonly dialog: MatDialog
  ) {
    super(desktopSyncService, openResourceResolver, router, dialog);
    this.connectorType = ConnectorType.SOLID;
    this.showConfigure = false;
    this.solidConnectorInfo = new SolidConnectorInfo(null);
  }

  public ngOnInit(): void {
    this.updateSyncDateTimeText();

    this.historyChangesSub = this.appService.historyChanges$.subscribe(() => {
      this.ngOnDestroy();
      this.ngOnInit();
    });

    this.solidConnectorInfo = this.solidConnectorInfoService.fetch();
  }

  public onWebidChange(): void {
    this.saveChanges();
  }

  public saveChanges(): void {
    this.solidConnectorInfoService.save(this.solidConnectorInfo);
    this.solidConnectorService
      .stop()
      .then(() => {
        this.solidConnectorService.sync().catch(err => {
          //this.logger.error("Error starting Solid sync:", err);
        });
      })
      .catch(err => {
        //this.logger.error("Error stopping Solid sync:", err);
      });
  }

  public ngOnDestroy(): void {
    this.historyChangesSub.unsubscribe();
  }
}
