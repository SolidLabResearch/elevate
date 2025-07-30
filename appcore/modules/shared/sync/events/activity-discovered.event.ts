import { SyncEventType } from "./sync-event-type";
import { SyncEvent } from "./sync.event";
import { ConnectorType } from "../connectors/connector-type.enum";
import { Activity } from "../../models/sync/activity.model";
import { ActivityFileType } from "../connectors/activity-file-type.enum";

export class ActivityDiscoveredEvent extends SyncEvent {
  public activityType: ActivityFileType;
  public activityLocation: string;

  constructor(
    fromConnectorType: ConnectorType,
    description: string,
    activityType: ActivityFileType,
    activityLocation: string
  ) {
    super(SyncEventType.DISCOVERED_ACTIVITY, fromConnectorType, description);
    this.activityType = activityType;
    this.activityLocation = activityLocation;
  }
}
