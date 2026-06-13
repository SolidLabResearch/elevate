import { ChangeDetectorRef, Component, Inject, OnDestroy, OnInit } from "@angular/core";
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
import { LoggerService } from "../../../shared/services/logging/logger.service";

@Component({
  selector: "app-solid-connector",
  templateUrl: "./solid-connector.component.html",
  styleUrls: ["./solid-connector.component.scss"]
})
export class SolidConnectorComponent extends ConnectorsComponent implements OnInit, OnDestroy {
  public showConfigure: boolean;
  public solidConnectorInfo: SolidConnectorInfo;
  public isLoggedIn: boolean;
  public isHandlingAuthFlow: boolean;
  public isUploadingActivities: boolean;
  public historyChangesSub: Subscription;
  public followingAthleteWebId: string;
  public selectedAthleteWebId: string | null;

  constructor(
    @Inject(AppService) public readonly appService: AppService,
    @Inject(SolidConnectorInfoService) protected readonly solidConnectorInfoService: SolidConnectorInfoService,
    @Inject(SyncService) protected readonly desktopSyncService: DesktopSyncService,
    @Inject(SolidConnectorService) protected readonly solidConnectorService: SolidConnectorService,
    @Inject(OPEN_RESOURCE_RESOLVER) protected readonly openResourceResolver: OpenResourceResolver,
    @Inject(ElectronService) protected readonly electronService: ElectronService,
    @Inject(Router) protected readonly router: Router,
    @Inject(MatSnackBar) protected readonly snackBar: MatSnackBar,
    @Inject(MatDialog) protected readonly dialog: MatDialog,
    @Inject(LoggerService) protected readonly logger: LoggerService,
    @Inject(ChangeDetectorRef) protected readonly changeDetectorRef: ChangeDetectorRef
  ) {
    super(desktopSyncService, openResourceResolver, router, dialog);
    this.connectorType = ConnectorType.SOLID;
    this.showConfigure = false;
    this.solidConnectorInfo = new SolidConnectorInfo(null);
    this.isLoggedIn = false;
    this.isHandlingAuthFlow = false;
    this.isUploadingActivities = false;
    this.followingAthleteWebId = "";
    this.selectedAthleteWebId = null;
  }

  public ngOnInit(): void {
    this.updateSyncDateTimeText();
    this.solidConnectorInfo = this.solidConnectorInfoService.fetch();
    this.selectedAthleteWebId = this.solidConnectorInfo.selectedAthleteWebIds[0] || null;
    this.handleAggregatorReturn().catch(err => {
      this.logger.error("Error while handling Solid aggregator return:", err);
      this.snackBar.open(err?.message || "Unable to complete aggregator login.", "Ok", { duration: 5000 });
    });

    this.initializeAuthFlow()
      .then(() => this.initializePodSettingsOnStartup())
      .catch(err => {
        this.logger.error("Error while initializing Solid auth flow:", err);
      });

    this.historyChangesSub = this.appService.historyChanges$.subscribe(() => {
      this.ngOnDestroy();
      this.ngOnInit();
    });
  }

  public onAggregatorConfigChange(): void {
    this.solidConnectorInfo = this.solidConnectorInfoService.save(
      new SolidConnectorInfo(
        this.solidConnectorInfo.webId,
        this.solidConnectorInfo.issuer,
        this.solidConnectorInfo.clientId,
        this.solidConnectorInfo.authSession,
        null,
        this.solidConnectorInfo.aggregatorBaseUrl,
        null,
        this.solidConnectorInfo.followingAthleteWebIds,
        this.solidConnectorInfo.selectedAthleteWebIds
      )
    );
  }

  public onAuthConfigChange(): void {
    this.solidConnectorInfo = this.solidConnectorService.updateAuthConfiguration(this.solidConnectorInfo.issuer);
  }

  public login(): void {
    this.isHandlingAuthFlow = true;
    this.solidConnectorService.updateAuthConfiguration(this.solidConnectorInfo.issuer);
    this.solidConnectorService
      .login(this.solidConnectorInfo.issuer)
      .then(async () => {
        this.solidConnectorInfo = this.solidConnectorInfoService.fetch();
        await this.refreshLoginState();
        this.ensureFollowingAthlete(this.solidConnectorInfo.webId, true);
        if (this.selectedAthleteWebId) {
          this.saveChanges();
        }
        this.snackBar.open("Solid login successful.", "Ok", { duration: 2000 });
      })
      .catch(err => {
        this.logger.error("Error starting Solid login:", err);
        this.snackBar.open(err?.message || "Unable to start Solid login. Check issuer.", "Ok", {
          duration: 3000
        });
      })
      .finally(() => {
        this.isHandlingAuthFlow = false;
        this.changeDetectorRef.detectChanges();
      });
  }

  public logout(): void {
    this.isHandlingAuthFlow = true;
    this.solidConnectorService
      .logout()
      .then(solidConnectorInfo => {
        this.solidConnectorInfo = solidConnectorInfo;
        this.selectedAthleteWebId = null;
        this.isLoggedIn = false;
        this.solidConnectorService.stop().catch(err => {
          this.logger.error("Error stopping Solid sync after logout:", err);
        });
        this.snackBar.open("Logged out from Solid.", "Ok", { duration: 2000 });
      })
      .catch(err => {
        this.logger.error("Error while logging out from Solid:", err);
      })
      .finally(() => {
        this.isHandlingAuthFlow = false;
      });
  }

  public saveChanges(): void {
    this.solidConnectorInfo.selectedAthleteWebIds = this.selectedAthleteWebId ? [this.selectedAthleteWebId] : [];
    this.solidConnectorInfo = this.solidConnectorInfoService.save(this.solidConnectorInfo);
    this.selectedAthleteWebId = this.solidConnectorInfo.selectedAthleteWebIds[0] || null;
    this.solidConnectorService.refreshActivitySelection();
    this.solidConnectorService
      .stop()
      .then(() => {
        this.solidConnectorService.sync().catch(err => {
          this.logger.error("Error starting Solid sync:", err);
        });
      })
      .catch(err => {
        this.logger.error("Error stopping Solid sync:", err);
      });
  }

  public addFollowingAthlete(): void {
    this.ensureFollowingAthlete(this.followingAthleteWebId, false);
    this.followingAthleteWebId = "";
    this.saveChanges();
  }

  public addYourselfAsFollowingAthlete(): void {
    this.ensureFollowingAthlete(this.solidConnectorInfo.webId || this.solidConnectorService.getWebId(), true);
    this.saveChanges();
  }

  public removeFollowingAthlete(webId: string): void {
    this.solidConnectorInfo.followingAthleteWebIds = this.solidConnectorInfo.followingAthleteWebIds.filter(
      athleteWebId => athleteWebId !== webId
    );
    this.solidConnectorInfo.selectedAthleteWebIds = this.solidConnectorInfo.selectedAthleteWebIds.filter(
      athleteWebId => athleteWebId !== webId
    );
    this.selectedAthleteWebId = this.solidConnectorInfo.selectedAthleteWebIds[0] || null;
    this.saveChanges();
  }

  public onSelectedAthletesChange(): void {
    this.solidConnectorInfo.selectedAthleteWebIds = this.selectedAthleteWebId ? [this.selectedAthleteWebId] : [];
    this.saveChanges();
  }

  private ensureFollowingAthlete(webId: string | null, select: boolean): void {
    const normalizedWebId = webId?.trim();
    if (!normalizedWebId) {
      return;
    }
    if (!this.solidConnectorInfo.followingAthleteWebIds.includes(normalizedWebId)) {
      this.solidConnectorInfo.followingAthleteWebIds = [
        ...this.solidConnectorInfo.followingAthleteWebIds,
        normalizedWebId
      ];
    }
    if (select) {
      this.selectedAthleteWebId = normalizedWebId;
      this.solidConnectorInfo.selectedAthleteWebIds = [normalizedWebId];
    }
  }

  public onActivityFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    this.isUploadingActivities = true;
    this.solidConnectorService
      .uploadActivities(files)
      .then(result => {
        if (result.uploadedCount > 0) {
          const uploadedLabel = result.uploadedCount === 1 ? "activity" : "activities";
          if (result.skippedCount > 0) {
            this.snackBar.open(
              `Uploaded ${result.uploadedCount} ${uploadedLabel}. Skipped ${result.skippedCount} unsupported file(s).`,
              "Ok",
              { duration: 3500 }
            );
          } else {
            this.snackBar.open(`Uploaded ${result.uploadedCount} ${uploadedLabel}.`, "Ok", { duration: 2500 });
          }
          this.waitForAggregatorAfterUpload(result.uploadedCount);
        } else {
          this.snackBar.open("No supported files selected. Choose .fit or .gpx files.", "Ok", { duration: 3000 });
        }
      })
      .catch(err => {
        this.logger.error("Error uploading Solid activities:", err);
        this.snackBar.open(err?.message || "Failed to upload activity files.", "Ok", { duration: 3500 });
      })
      .finally(() => {
        this.isUploadingActivities = false;
        input.value = "";
      });
  }

  private waitForAggregatorAfterUpload(uploadedCount: number): void {
    this.solidConnectorService
      .waitForAggregatedActivityLocations(uploadedCount)
      .then(discoveredLocations => {
        if (discoveredLocations.length === 0) {
          this.logger.warn("No aggregated Solid activities were discovered after upload before timeout.");
          return;
        }

        this.restartSolidSyncAfterUpload();
      })
      .catch(err => {
        this.logger.error("Error waiting for aggregated Solid activities:", err);
      });
  }

  private restartSolidSyncAfterUpload(): void {
    this.solidConnectorService
      .stop()
      .catch(() => Promise.resolve())
      .then(() => {
        this.solidConnectorService.sync().catch(err => {
          this.logger.error("Error restarting Solid sync after upload:", err);
        });
      });
  }

  private async initializeAuthFlow(): Promise<void> {
    this.isHandlingAuthFlow = true;

    try {
      const infoFromRedirect = await this.solidConnectorService.handleIncomingRedirect();
      if (infoFromRedirect) {
        this.solidConnectorInfo = infoFromRedirect;
        this.solidConnectorInfo = this.solidConnectorInfoService.save(
          new SolidConnectorInfo(
            this.solidConnectorService.getWebId() || this.solidConnectorInfo.webId,
            this.solidConnectorInfo.issuer,
            this.solidConnectorInfo.clientId,
            this.solidConnectorInfo.authSession,
            null,
            this.solidConnectorInfo.aggregatorBaseUrl,
            this.solidConnectorInfo.aggregatorUrl,
            this.solidConnectorInfo.followingAthleteWebIds,
            this.solidConnectorInfo.selectedAthleteWebIds
          )
        );
        this.ensureFollowingAthlete(this.solidConnectorInfo.webId || this.solidConnectorService.getWebId(), true);
        this.snackBar.open("Solid login successful.", "Ok", { duration: 2000 });
        if (this.selectedAthleteWebId) {
          this.saveChanges();
        }
      }
    } finally {
      this.isHandlingAuthFlow = false;
      await this.refreshLoginState();
    }
  }

  private async handleAggregatorReturn(): Promise<void> {
    const url = new URL(window.location.href);
    let aggregatorUrl = url.searchParams.get("aggregator");
    if (!aggregatorUrl) {
      aggregatorUrl = await this.solidConnectorService.completePendingAggregatorAuthorizationFromRedirect();
    }
    if (!aggregatorUrl) {
      return;
    }

    this.solidConnectorInfo = this.solidConnectorInfoService.save(
      new SolidConnectorInfo(
        this.solidConnectorInfo.webId,
        this.solidConnectorInfo.issuer,
        this.solidConnectorInfo.clientId,
        this.solidConnectorInfo.authSession,
        null,
        this.solidConnectorInfo.aggregatorBaseUrl,
        aggregatorUrl,
        this.solidConnectorInfo.followingAthleteWebIds,
        this.solidConnectorInfo.selectedAthleteWebIds
      )
    );
    await this.solidConnectorService.writeConnectorPreferencesToPod();
    url.searchParams.delete("aggregator");
    url.searchParams.delete("aggregator_status");
    window.history.replaceState({}, document.title, url.toString());
  }

  private refreshLoginState(): Promise<void> {
    return this.solidConnectorService
      .isLoggedIn()
      .then(isLoggedIn => {
        this.isLoggedIn = isLoggedIn;
        this.solidConnectorInfo = this.solidConnectorInfoService.fetch();
        if (!isLoggedIn) {
          this.solidConnectorInfo = this.solidConnectorInfoService.resetLoggedOutState();
          this.selectedAthleteWebId = null;
          return;
        }
        const webIdFromToken = this.solidConnectorService.getWebId();
        if (webIdFromToken && webIdFromToken !== this.solidConnectorInfo.webId) {
          this.solidConnectorInfo = this.solidConnectorInfoService.save(
            new SolidConnectorInfo(
              webIdFromToken,
              this.solidConnectorInfo.issuer,
              this.solidConnectorInfo.clientId,
              this.solidConnectorInfo.authSession,
              null,
              this.solidConnectorInfo.aggregatorBaseUrl,
              this.solidConnectorInfo.aggregatorUrl,
              this.solidConnectorInfo.followingAthleteWebIds,
              this.solidConnectorInfo.selectedAthleteWebIds
            )
          );
        }
        this.ensureFollowingAthlete(webIdFromToken, this.solidConnectorInfo.selectedAthleteWebIds.length === 0);
        this.solidConnectorInfo = this.solidConnectorInfoService.save(this.solidConnectorInfo);
        this.selectedAthleteWebId = this.solidConnectorInfo.selectedAthleteWebIds[0] || null;
      })
      .catch(err => {
        this.logger.error("Error while checking Solid auth state:", err);
        this.isLoggedIn = false;
      })
      .finally(() => {
        this.changeDetectorRef.detectChanges();
      });
  }

  public initializeAggregator(): void {
    this.isHandlingAuthFlow = true;
    this.solidConnectorInfo = this.solidConnectorInfoService.save(this.solidConnectorInfo);
    this.solidConnectorService
      .ensureAggregatorInitialized()
      .then(solidConnectorInfo => {
        this.solidConnectorInfo = solidConnectorInfo;
        this.snackBar.open("Aggregator is ready.", "Ok", { duration: 2500 });
      })
      .catch(err => {
        this.logger.error("Error initializing Solid aggregator:", err);
        this.snackBar.open(err?.message || "Unable to initialize aggregator.", "Ok", { duration: 5000 });
      })
      .finally(() => {
        this.isHandlingAuthFlow = false;
      });
  }

  private initializePodSettingsOnStartup(): Promise<void> {
    return this.solidConnectorService.initializePodResourcesOnStartup().catch(err => {
      this.logger.error("Error initializing Solid pod settings:", err);
      this.snackBar.open(err?.message || "Unable to initialize Solid pod settings.", "Ok", { duration: 5000 });
    });
  }

  public ngOnDestroy(): void {
    this.historyChangesSub?.unsubscribe();
  }
}
