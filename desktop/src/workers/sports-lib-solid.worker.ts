import { SportsLibProcessor } from "../processors/sports-lib.processor";
import { parentPort, workerData } from "worker_threads";
import { serializeError } from "serialize-error";
import { ActivityFileType } from "@elevate/shared/sync/connectors/activity-file-type.enum";

export interface SportsLibSolidWorkerParams {
  activityFileBuffer: ArrayBuffer;
  srcFileType: ActivityFileType;
}

SportsLibProcessor.processString(workerData.activityFileBuffer, workerData.srcFileType)
  .then(result => {
    parentPort.postMessage({ data: result });
  })
  .catch(error => {
    parentPort.postMessage({ error: serializeError(error) });
  });
