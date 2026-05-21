import { Inject, Injectable } from "@angular/core";
import { LoggerService } from "../../shared/services/logging/logger.service";
import { VersionsProvider } from "../../shared/services/versions/versions-provider";
import { AppLoadService } from "../app-load.service";
import { DesktopMigrationService, UpgradeResult } from "../../desktop/migration/desktop-migration.service";
import { DataStore } from "../../shared/data-store/data-store";
import { FileConnectorInfoService } from "../../shared/services/file-connector-info/file-connector-info.service";
import { DesktopUpdateService } from "../../desktop/app-update/desktop-update.service";
import { AppRoutes } from "../../shared/models/app-routes";
import { GotItDialogComponent } from "../../shared/dialogs/got-it-dialog/got-it-dialog.component";
import { GotItDialogDataModel } from "../../shared/dialogs/got-it-dialog/got-it-dialog-data.model";
import { MatDialog } from "@angular/material/dialog";
import { Router } from "@angular/router";
import { SolidConnectorInfoService } from "../../shared/services/solid-connector-info/solid-connector-info.service";
import { SolidAuthSession } from "@elevate/shared/sync/connectors/solid-connector-info.model";

@Injectable()
export class DesktopLoadService extends AppLoadService {
  constructor(
    @Inject(DataStore) protected readonly dataStore: DataStore<object>,
    @Inject(VersionsProvider) private readonly versionsProvider: VersionsProvider,
    @Inject(DesktopUpdateService) private readonly desktopUpdateService: DesktopUpdateService,
    @Inject(DesktopMigrationService) private readonly desktopMigrationService: DesktopMigrationService,
    @Inject(FileConnectorInfoService) private readonly fsConnectorInfoService: FileConnectorInfoService,
    @Inject(SolidConnectorInfoService) private readonly solidConnectorInfoService: SolidConnectorInfoService,
    @Inject(Router) private readonly router: Router,
    @Inject(MatDialog) private readonly dialog: MatDialog,
    @Inject(LoggerService) private readonly logger: LoggerService
  ) {
    super(dataStore);
  }

  public loadApp(): Promise<void> {
    return super.loadApp().then(() => {
      let upgradeResult: UpgradeResult;
      return this.desktopMigrationService
        .upgrade()
        .then(migrationUpgradeResult => {
          upgradeResult = migrationUpgradeResult;
          return this.desktopUpdateService.handleUpdate();
        })
        .then(() => {
          return this.fsConnectorInfoService.ensureSourceDirectoryCompliance();
        })
        .then(() => {
          // Check if a version has been installed. If so show release note popup
          if (upgradeResult.toVersion) {
            this.versionsProvider.notifyInstalledVersion(upgradeResult.toVersion);
          }

          if (upgradeResult.firstInstall) {
            this.dialog
              .open(GotItDialogComponent, {
                minWidth: GotItDialogComponent.MIN_WIDTH,
                maxWidth: GotItDialogComponent.MAX_WIDTH,
                data: new GotItDialogDataModel(
                  "First install detected: please configure your athlete settings",
                  "It's the first time Elevate is started. Please configure your athlete settings before syncing any connectors.",
                  "Let's configure my athlete settings"
                ),
                disableClose: true
              })
              .afterClosed()
              .toPromise()
              .then(() => this.redirectToStartupRoute(true));
          } else {
            this.redirectToStartupRoute();
          }
        });
    });
  }

  private redirectToStartupRoute(useAthleteSettingsFallback: boolean = false): Promise<boolean> {
    if (!this.hasSolidAuthSession()) {
      if (!this.router.isActive(AppRoutes.connectors, false)) {
        return this.router.navigate([AppRoutes.connectors]);
      }
      return Promise.resolve(false);
    }

    if (useAthleteSettingsFallback) {
      return this.router.navigate([AppRoutes.athleteSettings]);
    }

    return Promise.resolve(false);
  }

  private hasSolidAuthSession(): boolean {
    const authSession: SolidAuthSession | null = this.solidConnectorInfoService.fetch().authSession;
    return !!authSession && !!(authSession.accessToken || authSession.idToken || authSession.refreshToken);
  }
}
