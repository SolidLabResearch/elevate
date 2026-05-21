import { SyncEventType } from "./sync-event-type";
import { SyncEvent } from "./sync.event";
import { ConnectorType } from "../connectors/connector-type.enum";

export class ActivityContainerSyncEvent extends SyncEvent {
  public containerIri: string;
  public activitySources: string[];
  public added: string[];
  public removed: string[];
  public changed: string[];
  public version: number;
  public lastUpdatedAt: number;

  constructor(
    fromConnectorType: ConnectorType,
    description: string,
    containerIri: string,
    activitySources: string[],
    added: string[] = [],
    removed: string[] = [],
    changed: string[] = [],
    version: number = 0,
    lastUpdatedAt: number = Date.now()
  ) {
    super(SyncEventType.ACTIVITY_CONTAINER, fromConnectorType, description);
    this.containerIri = containerIri;
    this.activitySources = activitySources;
    this.added = added;
    this.removed = removed;
    this.changed = changed;
    this.version = version;
    this.lastUpdatedAt = lastUpdatedAt;
  }
}
