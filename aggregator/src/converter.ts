import { ActivityRDFMapper } from "../../appcore/src/app/shared/dao/activity/activityRDFMapper";
import { FileConnector } from "../../desktop/src/connectors/file/file.connector";
import { ActivityComputeProcessor } from "../../desktop/src/processors/activity-compute/activity-compute.processor";
import { SportsLibProcessor } from "../../desktop/src/processors/sports-lib.processor";
import { ActivityTypes } from "@thomaschampagne/sports-lib/lib/activities/activity.types";
import { ActivityJSONInterface } from "@thomaschampagne/sports-lib/lib/activities/activity.json.interface";
import { Activity } from "@elevate/shared/models/sync/activity.model";
import { ActivityFileType } from "@elevate/shared/sync/connectors/activity-file-type.enum";
import { AthleteModel } from "@elevate/shared/models/athlete/athlete.model";
import { AthleteSnapshotResolver } from "@elevate/shared/resolvers/athlete-snapshot.resolver";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";
import { stableId } from "./crypto";
import { log } from "./log";

export interface ConversionResult {
  outputUrl: string;
  activity: Activity;
  turtle: string;
  logsInfo: string[];
}

const connector = new FileConnector(null, null, null, null, null, null, null);
const rdfMapper = new ActivityRDFMapper();

export async function convertActivityFileToRdf(input: {
  sourceUrl: string;
  sourceBuffer: Buffer;
  outputContainer: string;
  athleteModel: AthleteModel;
  userSettings: UserSettings.BaseUserSettings;
}): Promise<ConversionResult[]> {
  const fileType = fileTypeFromUrl(input.sourceUrl);
  log.info("converting activity file", {
    sourceUrl: input.sourceUrl,
    fileType,
    bytes: input.sourceBuffer.byteLength
  });
  const parsed = await SportsLibProcessor.processString(input.sourceBuffer as any, fileType as any);
  const athleteSnapshotResolver = new AthleteSnapshotResolver(input.athleteModel);
  const results: ConversionResult[] = [];
  log.info("activity file parsed", {
    sourceUrl: input.sourceUrl,
    activityCount: parsed.event.activities.length,
    logsInfoCount: parsed.logsInfo.length
  });

  for (let index = 0; index < parsed.event.activities.length; index++) {
    const sportsLibActivity = parsed.event.activities[index];
    if (sportsLibActivity.type === ActivityTypes.Transition) {
      log.info("skipping transition activity", {
        sourceUrl: input.sourceUrl,
        index
      });
      continue;
    }

    let activity = connector.createBareActivity(sportsLibActivity) as Partial<Activity>;
    const streams = connector.mapStreams(sportsLibActivity);
    activity = (connector as any).assignBaseProperties(activity, streams);
    activity.srcStats = connector.getSourceStats(
      activity.type,
      sportsLibActivity as Partial<ActivityJSONInterface>,
      streams
    );
    activity.laps = (connector as any).processLaps(activity.type, sportsLibActivity.laps);
    activity.device = readableDeviceName(sportsLibActivity);
    activity.notes = null;
    activity.extras = {
      file: {
        path: input.sourceUrl,
        type: fileType
      }
    } as any;

    const athleteSnapshot = athleteSnapshotResolver.resolve(activity.startTime);
    const computed = await ActivityComputeProcessor.compute(
      activity,
      athleteSnapshot,
      input.userSettings,
      streams,
      true,
      true,
      false,
      null,
      true,
      null
    );

    const outputId = outputResourceName(computed.computedActivity, input.sourceUrl, index);
    const outputUrl = new URL(outputId, ensureTrailingSlash(input.outputContainer)).toString();
    computed.computedActivity.id = outputId;

    results.push({
      outputUrl,
      activity: computed.computedActivity,
      turtle: rdfMapper.write(outputUrl, computed.computedActivity),
      logsInfo: parsed.logsInfo
    });
    log.info("activity converted to RDF", {
      sourceUrl: input.sourceUrl,
      index,
      outputUrl,
      activityType: computed.computedActivity.type,
      startTime: computed.computedActivity.startTime
    });
  }

  log.info("activity file conversion completed", {
    sourceUrl: input.sourceUrl,
    outputCount: results.length
  });
  return results;
}

function fileTypeFromUrl(url: string): ActivityFileType {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".fit")) {
    return ActivityFileType.FIT;
  }
  if (pathname.endsWith(".tcx")) {
    return ActivityFileType.TCX;
  }
  return ActivityFileType.GPX;
}

function readableDeviceName(activity: ActivityJSONInterface): string | null {
  const name = activity.creator?.name;
  if (!name || /unknown/iu.test(name)) {
    return null;
  }
  return name;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function outputResourceName(activity: Activity, sourceUrl: string, index: number): string {
  const readableName = slug(activity.name || sourceBasename(sourceUrl) || "activity");
  const suffix = stableId(`${sourceUrl}#${index}`);
  return `activity-metrics-${readableName}-${suffix}.ttl`;
}

function sourceBasename(sourceUrl: string): string {
  const pathname = new URL(sourceUrl).pathname;
  const name = pathname.split("/").filter(Boolean).pop() || "";
  return name.replace(/\.[^.]+$/u, "");
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "activity"
  );
}
