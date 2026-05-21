import { IpcListener } from "./ipc-listener.interface";
import { inject, singleton } from "tsyringe";
import { WorkerService } from "../worker-service";
import { WorkerType } from "../enum/worker-type.enum";
import { IpcTunnelService } from "@elevate/shared/electron/ipc-tunnel";
import { Channel } from "@elevate/shared/electron/channels.enum";
import { ActivityFileType } from "@elevate/shared/sync/connectors/activity-file-type.enum";
import { SportsLibSolidWorkerParams } from "../workers/sports-lib-solid.worker";
import { ActivityJSONInterface } from "@thomaschampagne/sports-lib/lib/activities/activity.json.interface";
import { DataTime } from "@thomaschampagne/sports-lib/lib/data/data.time";
import { DataPosition } from "@thomaschampagne/sports-lib/lib/data/data.position";
import { DataDistance } from "@thomaschampagne/sports-lib/lib/data/data.distance";
import { DataSpeed } from "@thomaschampagne/sports-lib/lib/data/data.speed";
import { DataHeartRate } from "@thomaschampagne/sports-lib/lib/data/data.heart-rate";
import { DataAltitude } from "@thomaschampagne/sports-lib/lib/data/data.altitude";
import { DataCadence } from "@thomaschampagne/sports-lib/lib/data/data.cadence";
import { DataPower } from "@thomaschampagne/sports-lib/lib/data/data.power";
import { DataTemperature } from "@thomaschampagne/sports-lib/lib/data/data.temperature";
import { Streams } from "@elevate/shared/models/activity-data/streams.model";

interface SolidRawStreamsRequest {
  rawActivityBuffer: ArrayBuffer;
  fileType: ActivityFileType;
  activityStartTime: string;
}

@singleton()
export class IpcComputeSolidRawStreamsListener implements IpcListener {
  constructor(@inject(WorkerService) private readonly workerService: WorkerService) {}

  public startListening(ipcTunnelService: IpcTunnelService): void {
    ipcTunnelService.on<Array<[SolidRawStreamsRequest]>, string | null>(Channel.computeSolidRawStreams, payload => {
      return this.handleComputeSolidRawStreams(payload[0][0]);
    });
  }

  private handleComputeSolidRawStreams(request: SolidRawStreamsRequest): Promise<string | null> {
    const startedAt = Date.now();
    console.info("[SolidStreamsTiming] main process raw stream compute started", {
      fileType: request.fileType,
      byteLength: request.rawActivityBuffer?.byteLength || 0
    });
    return this.workerService
      .exec<SportsLibSolidWorkerParams, { event: { activities: ActivityJSONInterface[] }; logsInfo: string[] }>(
        WorkerType.SPORTS_LIB_SOLID,
        {
          activityFileBuffer: request.rawActivityBuffer,
          srcFileType: request.fileType
        }
      )
      .then(result => {
        console.info("[SolidStreamsTiming] sports-lib worker completed", {
          elapsedMs: Date.now() - startedAt,
          activityCount: result.event.activities?.length || 0
        });
        const sportsLibActivity = this.findActivity(result.event.activities, request.activityStartTime);
        if (!sportsLibActivity) {
          console.info("[SolidStreamsTiming] no matching activity found in raw file", {
            elapsedMs: Date.now() - startedAt
          });
          return null;
        }

        const mapStartedAt = Date.now();
        const streams = this.mapStreams(sportsLibActivity);
        console.info("[SolidStreamsTiming] raw streams mapped", {
          elapsedMs: Date.now() - mapStartedAt,
          totalElapsedMs: Date.now() - startedAt,
          latLngCount: streams.latlng?.length || 0,
          timeCount: streams.time?.length || 0
        });
        const deflateStartedAt = Date.now();
        const deflatedStreams = Streams.deflate(streams);
        console.info("[SolidStreamsTiming] raw streams deflated", {
          elapsedMs: Date.now() - deflateStartedAt,
          totalElapsedMs: Date.now() - startedAt,
          deflatedSize: deflatedStreams.length
        });
        return deflatedStreams;
      });
  }

  private findActivity(activities: ActivityJSONInterface[], activityStartTime: string): ActivityJSONInterface | null {
    if (!activities || activities.length === 0) {
      return null;
    }
    if (activities.length === 1) {
      return activities[0];
    }

    const startTime = new Date(activityStartTime).getTime();
    return (
      activities.find(activity => Math.abs(activity.startDate - startTime) < 1000) ||
      activities.find(activity => Math.abs(activity.startDate - startTime) < 60000) ||
      null
    );
  }

  private mapStreams(sportsLibActivity: ActivityJSONInterface): Streams {
    const streams = new Streams();

    if (sportsLibActivity.streams[DataTime.type]) {
      streams.time = sportsLibActivity.streams[DataTime.type];
    }
    if (sportsLibActivity.streams[DataPosition.type]) {
      streams.latlng = sportsLibActivity.streams[DataPosition.type];
    }
    if (sportsLibActivity.streams[DataDistance.type]) {
      streams.distance = sportsLibActivity.streams[DataDistance.type];
    }
    if (sportsLibActivity.streams[DataSpeed.type]) {
      streams.velocity_smooth = sportsLibActivity.streams[DataSpeed.type];
    }
    if (sportsLibActivity.streams[DataHeartRate.type]) {
      streams.heartrate = sportsLibActivity.streams[DataHeartRate.type];
    }
    if (sportsLibActivity.streams[DataAltitude.type]) {
      streams.altitude = sportsLibActivity.streams[DataAltitude.type];
    }
    if (sportsLibActivity.streams[DataCadence.type]) {
      streams.cadence = sportsLibActivity.streams[DataCadence.type];
    }
    if (sportsLibActivity.streams[DataPower.type]) {
      streams.watts = sportsLibActivity.streams[DataPower.type];
    }
    if (sportsLibActivity.streams[DataTemperature.type]) {
      streams.temp = sportsLibActivity.streams[DataTemperature.type];
    }

    return streams;
  }
}
