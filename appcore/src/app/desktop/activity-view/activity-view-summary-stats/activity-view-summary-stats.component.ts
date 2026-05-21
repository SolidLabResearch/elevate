import { Component, Inject, Input, OnChanges, OnInit, SimpleChanges } from "@angular/core";
import { ActivityStatsService } from "../shared/activity-stats.service";
import { StatDisplay } from "../shared/models/stats/display/stat-display.model";
import { MediaObserver } from "@angular/flex-layout";
import { ActivityViewMapComponent } from "../activity-view-map/activity-view-map.component";
import { SummaryStatsGroup } from "../shared/models/stats/summary-stat-group.model";
import { MeasureSystem } from "@elevate/shared/enums/measure-system.enum";
import { Activity } from "@elevate/shared/models/sync/activity.model";

@Component({
  selector: "app-activity-view-summary-stats",
  templateUrl: "./activity-view-summary-stats.component.html",
  styleUrls: ["./activity-view-summary-stats.component.scss"]
})
export class ActivityViewSummaryStatsComponent implements OnInit, OnChanges {
  public summaryStatDisplays: StatDisplay[];

  public columnsCount: number;
  public rowCount: number;
  public rowHeight: number;

  @Input()
  public activity: Activity;

  @Input()
  public measureSystem: MeasureSystem;

  @Input()
  public hasMapData: boolean;

  constructor(
    @Inject(ActivityStatsService) protected readonly statsService: ActivityStatsService,
    @Inject(MediaObserver) public readonly mediaObserver: MediaObserver
  ) {}

  public ngOnInit(): void {
    this.updateGridLayout();
    this.summaryStatDisplays = this.statsService.getSummaryStats(this.activity, this.measureSystem);
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes.hasMapData && !changes.hasMapData.firstChange) {
      this.updateGridLayout();
    }
  }

  private updateGridLayout(): void {
    this.columnsCount = this.hasMapData
      ? SummaryStatsGroup.DEFAULT_COLUMNS_COUNT
      : SummaryStatsGroup.DEFAULT_COLUMNS_COUNT * SummaryStatsGroup.DEFAULT_ROW_COUNT;

    this.rowCount = SummaryStatsGroup.DEFAULT_ROW_COUNT;

    this.rowHeight = ActivityViewMapComponent.MAP_HEIGHT_PX / SummaryStatsGroup.DEFAULT_ROW_COUNT;
  }
}
