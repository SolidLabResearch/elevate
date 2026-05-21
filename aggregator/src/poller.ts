import { AggregatorInstance, WebhookTopicKind } from "./types";
import {
  fetchBinary,
  listActivityFiles,
  readAthleteModel,
  readUserSettings,
  resourceExists,
  resourceSignature,
  subscribeWebhook,
  unsubscribeWebhook,
  writeTurtle
} from "./solid";
import { convertActivityFileToRdf } from "./converter";
import { config } from "./config";
import { log } from "./log";
import { AthleteModel } from "@elevate/shared/models/athlete/athlete.model";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";

type ProcessReason = "startup" | "source-webhook" | "settings-webhook" | "manual";

interface WebhookNotification {
  type?: string;
  object?: string;
  target?: string;
  state?: string;
}

const running = new Map<string, Promise<void>>();
const queued = new Map<string, { forceRecalculate: boolean; reason: ProcessReason }>();

export function startAggregator(instance: AggregatorInstance): void {
  log.info("starting webhook-driven aggregator", {
    id: instance.id,
    sourceContainer: instance.sourceContainer,
    outputContainer: instance.outputContainer,
    webhookBase: `${config.baseUrl}/webhooks/${instance.id}/`
  });

  void ensureWebhookSubscriptions(instance).catch(err => {
    log.warn("webhook subscription setup failed", {
      id: instance.id,
      message: err instanceof Error ? err.message : String(err)
    });
  });
  enqueueProcessing(instance, "startup", false);
}

export function stopAggregator(instanceId: string): void {
  log.info("stopping webhook-driven aggregator", { id: instanceId });
  queued.delete(instanceId);
}

export async function stopWebhookSubscriptions(instance: AggregatorInstance): Promise<void> {
  const subscriptions = Object.values(instance.webhookSubscriptions || {}).filter(Boolean);
  instance.webhookSubscriptions = {};
  await Promise.all(
    subscriptions.map(subscription =>
      subscription.channelId
        ? unsubscribeWebhook(instance.tokenSet, subscription.channelId).catch(err => {
            log.warn("could not delete webhook subscription", {
              id: instance.id,
              channelId: subscription.channelId,
              message: err instanceof Error ? err.message : String(err)
            });
          })
        : Promise.resolve()
    )
  );
}

export async function ensureWebhookSubscriptions(instance: AggregatorInstance): Promise<void> {
  log.info("webhook subscription setup started", {
    id: instance.id,
    sourceContainer: instance.sourceContainer,
    athleteSettingsUrl: instance.athleteSettingsUrl,
    userSettingsUrl: instance.userSettingsUrl
  });
  await Promise.all([
    ensureWebhookSubscription(instance, "source", instance.sourceContainer),
    ensureWebhookSubscription(instance, "athlete-settings", instance.athleteSettingsUrl),
    ensureWebhookSubscription(instance, "user-settings", instance.userSettingsUrl)
  ]);
  log.info("webhook subscription setup completed", {
    id: instance.id,
    subscriptions: Object.fromEntries(
      Object.entries(instance.webhookSubscriptions).map(([kind, subscription]) => [
        kind,
        {
          topic: subscription?.topic || null,
          channelId: subscription?.channelId || null,
          sender: subscription?.sender || null
        }
      ])
    )
  });
}

export function handleWebhook(
  instance: AggregatorInstance,
  kind: WebhookTopicKind,
  notification: WebhookNotification
): void {
  log.info("webhook notification received", {
    id: instance.id,
    kind,
    type: notification.type || null,
    object: notification.object || null,
    target: notification.target || null,
    state: notification.state || null
  });

  if (kind === "athlete-settings" || kind === "user-settings") {
    enqueueProcessing(instance, "settings-webhook", true);
    return;
  }

  enqueueProcessing(instance, "source-webhook", false);
}

function enqueueProcessing(instance: AggregatorInstance, reason: ProcessReason, forceRecalculate: boolean): void {
  const active = running.get(instance.id);
  if (active) {
    const existing = queued.get(instance.id);
    queued.set(instance.id, {
      reason,
      forceRecalculate: forceRecalculate || Boolean(existing?.forceRecalculate)
    });
    log.info("aggregator processing queued", {
      id: instance.id,
      reason,
      forceRecalculate
    });
    return;
  }

  const run = processOnce(instance, reason, forceRecalculate)
    .catch(err => {
      instance.lastExecution = {
        id: `execution-${Date.now()}`,
        source: instance.sourceContainer,
        output: instance.outputContainer,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      };
      log.error("aggregator processing failed", {
        id: instance.id,
        reason,
        forceRecalculate,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : null
      });
    })
    .finally(() => {
      running.delete(instance.id);
      const next = queued.get(instance.id);
      if (next) {
        queued.delete(instance.id);
        enqueueProcessing(instance, next.reason, next.forceRecalculate);
      }
    });
  running.set(instance.id, run);
}

async function ensureWebhookSubscription(
  instance: AggregatorInstance,
  kind: WebhookTopicKind,
  topic: string
): Promise<void> {
  if (instance.webhookSubscriptions[kind]?.topic === topic) {
    log.info("webhook subscription already configured", {
      id: instance.id,
      kind,
      topic,
      channelId: instance.webhookSubscriptions[kind]?.channelId || null
    });
    return;
  }

  const sendTo = `${config.baseUrl}/webhooks/${instance.id}/${kind}/${instance.webhookSecret}`;
  log.info("webhook subscription requested", {
    id: instance.id,
    kind,
    topic,
    sendTo
  });
  const channel = await subscribeWebhook(instance.tokenSet, topic, sendTo);
  if (!channel) {
    log.warn("webhook subscription unavailable; changes require manual retry or startup scan", {
      id: instance.id,
      kind,
      topic
    });
    return;
  }

  instance.webhookSubscriptions[kind] = {
    topic,
    sendTo,
    channelId: channel.id,
    sender: channel.sender,
    createdAt: new Date().toISOString()
  };
  log.info("webhook subscription stored", {
    id: instance.id,
    kind,
    topic,
    channelId: channel.id,
    sender: channel.sender
  });
}

async function processOnce(
  instance: AggregatorInstance,
  reason: ProcessReason,
  forceRecalculate: boolean
): Promise<void> {
  log.info("aggregator processing started", {
    id: instance.id,
    reason,
    forceRecalculate,
    sourceContainer: instance.sourceContainer
  });

  const settingsSignature = await readSettingsSignature(instance);
  const settingsChanged = Boolean(instance.settingsSignature && settingsSignature !== instance.settingsSignature);
  const recalculateAll = forceRecalculate || settingsChanged;

  if (settingsChanged) {
    log.info("settings signature changed; recalculating all activity outputs", {
      id: instance.id,
      previousSignature: instance.settingsSignature,
      nextSignature: settingsSignature
    });
  }

  const resources = await listActivityFiles(instance.tokenSet, instance.sourceContainer);
  log.info("aggregator discovered resources", {
    id: instance.id,
    reason,
    count: resources.length,
    recalculateAll
  });

  const athleteModel = await readAthleteModel(instance.tokenSet, instance.athleteSettingsUrl);
  const userSettings = await readUserSettings(instance.tokenSet, instance.userSettingsUrl);

  for (const resource of resources) {
    const signature = resource.etag || "seen";
    if (!recalculateAll && instance.processedSources[resource.iri] === signature) {
      log.info("skipping unchanged activity source", {
        id: instance.id,
        source: resource.iri,
        signature
      });
      continue;
    }

    await processActivityResource(instance, resource.iri, signature, athleteModel, userSettings, recalculateAll);
  }

  instance.settingsSignature = settingsSignature;
  log.info("aggregator processing completed", {
    id: instance.id,
    reason,
    resourceCount: resources.length,
    settingsSignature
  });
}

async function processActivityResource(
  instance: AggregatorInstance,
  sourceUrl: string,
  signature: string,
  athleteModel: AthleteModel,
  userSettings: UserSettings.BaseUserSettings,
  forceWrite: boolean
): Promise<void> {
  const startedAt = new Date().toISOString();
  log.info("processing activity source", {
    id: instance.id,
    source: sourceUrl,
    signature,
    forceWrite
  });

  const buffer = await fetchBinary(instance.tokenSet, sourceUrl);
  const converted = await convertActivityFileToRdf({
    sourceUrl,
    sourceBuffer: buffer,
    outputContainer: instance.outputContainer,
    athleteModel,
    userSettings
  });

  log.info("activity source converted", {
    id: instance.id,
    source: sourceUrl,
    outputCount: converted.length
  });

  for (const result of converted) {
    const exists = await resourceExists(instance.tokenSet, result.outputUrl);
    if (!exists || forceWrite || instance.processedSources[sourceUrl] !== signature) {
      await writeTurtle(instance.tokenSet, result.outputUrl, result.turtle);
    } else {
      log.info("output resource already up to date", {
        id: instance.id,
        source: sourceUrl,
        output: result.outputUrl
      });
    }
    instance.lastExecution = {
      id: `execution-${Date.now()}`,
      source: sourceUrl,
      output: result.outputUrl,
      startedAt,
      endedAt: new Date().toISOString(),
      status: "success"
    };
  }

  instance.processedSources[sourceUrl] = signature;
  log.info("activity source processed", {
    id: instance.id,
    source: sourceUrl,
    signature
  });
}

async function readSettingsSignature(instance: AggregatorInstance): Promise<string> {
  const [athleteSignature, userSignature] = await Promise.all([
    resourceSignature(instance.tokenSet, instance.athleteSettingsUrl),
    resourceSignature(instance.tokenSet, instance.userSettingsUrl)
  ]);
  return `athlete=${athleteSignature || "missing"};user=${userSignature || "missing"}`;
}
