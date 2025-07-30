import _ from "lodash";
import { ActivityFileType } from "@elevate/shared/sync/connectors/activity-file-type.enum";

/**
 * Model associated to Solid synced activities
 */
export class ActivitySolid {
  public type: ActivityFileType;
  public location: string;
  public dataBuffer: ArrayBuffer;
  public lastModificationDate: string;

  constructor(type: ActivityFileType, location: string, dataBuffer: ArrayBuffer, lastModificationDate: Date) {
    this.type = type;
    this.location = location;
    this.dataBuffer = dataBuffer;
    this.lastModificationDate = _.isDate(lastModificationDate) ? lastModificationDate.toISOString() : null;
  }
}
