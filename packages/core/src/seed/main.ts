import {
  ChannelSpecSchema,
  MonitorSpecSchema,
  REGIONS,
  SloSpecSchema,
  initialMonitorState,
  type MonitorSpec,
  type MonitorState,
  type Region,
  type RegionObservation,
} from "@beacon/shared";
import { Types } from "mongoose";
import { z } from "zod";
import { BaseEnvSchema, loadEnv } from "../env.js";
import { createLogger } from "../logger.js";
import {
  ChannelModel,
  CheckResultModel,
  IncidentModel,
  IncidentUpdateModel,
  MaintenanceModel,
  MonitorModel,
  NotificationModel,
  OrgModel,
  RollupModel,
  SloModel,
  type Granularity,
  type NotificationStatus,
} from "../models/index.js";
import { connectMongo, disconnectMongo, ensureCollections } from "../mongo.js";
import { hashApiKey } from "../repositories/orgs.js";
import { ROLLUP_RETENTION_MS, floorTo } from "../services/rollups.js";
import {
  DEMO_INCIDENTS,
  DEMO_SLOS,
  demoChannels,
  demoMonitors,
  type DemoMonitor,
  type TcpTarget,
} from "./demo.js";
import {
  accumulate,
  emptyAccumulator,
  mulberry32,
  synthesizeProbe,
  type Disruption,
  type HourAccumulator,
} from "./history.js";

function toTcpTarget(value: string, ctx: z.RefinementCtx): TcpTarget {
  const [host, port] = value.split(":");
  const parsed = Number(port);
  if (!host || !Number.isInteger(parsed)) {
    ctx.addIssue({ code: "custom", message: "Use host:port" });
    return { host: "127.0.0.1", port: 0 };
  }
  return { host, port: parsed };
}

const SeedEnvSchema = BaseEnvSchema.extend({
  DEMO_ORG_SLUG: z.string().default("acme"),
  DEMO_API_KEY: z.string().min(16).default("bk_demo_acme_local_development_key"),
  CHAOS_URL: z.url().default("http://127.0.0.1:5511"),
  SEED_DATABASE_TCP: z.string().default("127.0.0.1:27111").transform(toTcpTarget),
  SEED_CACHE_TCP: z.string().default("127.0.0.1:6411").transform(toTcpTarget),
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 90;
const HOURLY_DAYS = 45;
const MINUTE_HOURS = 26;
const RAW_HOURS = 2;

const env = loadEnv(SeedEnvSchema);
const logger = createLogger("seed", env.LOG_LEVEL);

interface RegionalDisruption extends Disruption {
  regions: readonly Region[];
}

interface Buckets {
  "1m": Map<number, HourAccumulator>;
  "1h": Map<number, HourAccumulator>;
  "1d": Map<number, HourAccumulator>;
}

function bucketsFor(
  monitor: DemoMonitor,
  spec: MonitorSpec,
  disruptions: readonly RegionalDisruption[],
  now: Date,
  seed: number,
  onRaw: (region: Region, at: Date, status: "up" | "degraded" | "down", latencyMs: number) => void,
): Buckets {
  const random = mulberry32(seed);
  const buckets: Buckets = { "1m": new Map(), "1h": new Map(), "1d": new Map() };
  const start = floorTo(new Date(now.getTime() - (HISTORY_DAYS - 1) * DAY), "1d").getTime();
  const hourlyFrom = now.getTime() - HOURLY_DAYS * DAY;
  const minuteFrom = now.getTime() - MINUTE_HOURS * HOUR;
  const rawFrom = now.getTime() - RAW_HOURS * HOUR;
  const step = spec.intervalSeconds * 1000;

  // A slow random walk per day keeps long-range charts from looking like a pure sine wave.
  let level = 1;
  const dailyProfiles = Array.from({ length: HISTORY_DAYS + 1 }, () => {
    level = Math.min(1.3, Math.max(0.82, level + (random() - 0.5) * 0.12));
    return { ...monitor.profile, baseMs: monitor.profile.baseMs * level };
  });

  const add = (
    granularity: Granularity,
    at: number,
    probe: { status: "up" | "degraded" | "down"; latencyMs: number },
  ) => {
    const key = floorTo(new Date(at), granularity).getTime();
    const map = buckets[granularity];
    let acc = map.get(key);
    if (!acc) {
      acc = emptyAccumulator();
      map.set(key, acc);
    }
    accumulate(acc, probe);
  };

  spec.regions.forEach((region, index) => {
    const regional = disruptions.filter((d) => d.regions.includes(region));
    const offset = Math.floor((step / spec.regions.length) * index);
    for (let at = start + offset; at < now.getTime(); at += step) {
      const when = new Date(at);
      const profile = dailyProfiles[Math.floor((at - start) / DAY)] ?? monitor.profile;
      const probe = synthesizeProbe(profile, when, regional, spec.degradedLatencyMs, random, 0.00004);
      add("1d", at, probe);
      if (at >= hourlyFrom) add("1h", at, probe);
      if (at >= minuteFrom) add("1m", at, probe);
      if (at >= rawFrom) onRaw(region, when, probe.status, probe.latencyMs);
    }
  });
  return buckets;
}

function rollupDocs(monitorId: Types.ObjectId, orgId: Types.ObjectId, buckets: Buckets) {
  return (Object.keys(buckets) as Granularity[]).flatMap((granularity) =>
    [...buckets[granularity].entries()].map(([bucket, acc]) => ({
      monitorId,
      orgId,
      granularity,
      bucket: new Date(bucket),
      ...acc,
      expiresAt: new Date(bucket + ROLLUP_RETENTION_MS[granularity]),
    })),
  );
}

async function resetOrg(slug: string): Promise<void> {
  const existing = await OrgModel.findOne({ slug }).lean().exec();
  if (!existing) return;
  const orgId = existing._id;
  const monitorIds = (await MonitorModel.find({ orgId }, { _id: 1 }).lean().exec()).map((m) => m._id);
  await Promise.all([
    MonitorModel.deleteMany({ orgId }).exec(),
    RollupModel.deleteMany({ orgId }).exec(),
    IncidentModel.deleteMany({ orgId }).exec(),
    IncidentUpdateModel.deleteMany({ orgId }).exec(),
    SloModel.deleteMany({ orgId }).exec(),
    ChannelModel.deleteMany({ orgId }).exec(),
    NotificationModel.deleteMany({ orgId }).exec(),
    MaintenanceModel.deleteMany({ orgId }).exec(),
    monitorIds.length > 0
      ? CheckResultModel.deleteMany({ "meta.monitorId": { $in: monitorIds } }).exec()
      : null,
  ]);
  await OrgModel.deleteOne({ _id: orgId }).exec();
}

function liveState(spec: MonitorSpec, demo: DemoMonitor, now: Date, random: () => number): MonitorState {
  const regions: Partial<Record<Region, RegionObservation>> = {};
  for (const region of spec.regions) {
    const probe = synthesizeProbe(demo.profile, now, [], spec.degradedLatencyMs, random, 0);
    regions[region] = { status: probe.status, latencyMs: probe.latencyMs, error: null, at: now };
  }
  return {
    ...initialMonitorState(),
    status: "up",
    since: new Date(now.getTime() - 3 * DAY),
    regions,
    streakVerdict: "up",
    streakCount: 10,
    okStreak: 10,
    lastCheckedAt: now,
  };
}

async function main(): Promise<void> {
  await connectMongo(env.MONGO_URL, logger);
  await ensureCollections({ rawRetentionDays: env.RAW_RETENTION_DAYS });
  await resetOrg(env.DEMO_ORG_SLUG);

  const now = new Date();
  const org = await OrgModel.create({
    name: "Acme Cloud",
    slug: env.DEMO_ORG_SLUG,
    statusPage: {
      title: "Acme Cloud Status",
      description: "Live availability of the Acme storefront, APIs and supporting infrastructure.",
      groups: ["Storefront", "Core platform", "Edge & certificates"],
      supportUrl: "https://acme.dev/support",
    },
    apiKeys: [
      {
        name: "demo",
        prefix: env.DEMO_API_KEY.slice(0, 7),
        hash: hashApiKey(env.DEMO_API_KEY),
        createdAt: now,
      },
    ],
  });
  const orgId = org._id;

  const demos = demoMonitors(env.CHAOS_URL, env.SEED_DATABASE_TCP, env.SEED_CACHE_TCP);
  const monitorIds = new Map<string, Types.ObjectId>();
  const random = mulberry32(7);
  let rollupCount = 0;
  let rawCount = 0;

  for (const [index, demo] of demos.entries()) {
    const spec = MonitorSpecSchema.parse(demo.spec);
    const monitorId = new Types.ObjectId();
    monitorIds.set(spec.key, monitorId);

    const disruptions: RegionalDisruption[] = DEMO_INCIDENTS.filter((i) => i.monitor === spec.key).map(
      (i) => ({
        start: new Date(now.getTime() - i.startedAgoMs),
        end: new Date(now.getTime() - i.startedAgoMs + i.durationMs),
        regions: REGIONS,
        ...i.disruption,
      }),
    );
    if (spec.key === "storefront") {
      // A single-region blip that quorum correctly ignored: no incident was opened for it.
      disruptions.push({
        start: new Date(now.getTime() - 5 * DAY - 4 * HOUR),
        end: new Date(now.getTime() - 5 * DAY - 3.6 * HOUR),
        kind: "down",
        severity: 1,
        regions: ["ap-southeast"],
      });
    }

    const raw: {
      ts: Date;
      meta: { monitorId: Types.ObjectId; orgId: Types.ObjectId; region: Region };
      status: string;
      latencyMs: number;
      error: string | null;
      details: Record<string, unknown>;
    }[] = [];
    const buckets = bucketsFor(
      demo,
      spec,
      disruptions,
      now,
      1000 + index,
      (region, at, status, latencyMs) => {
        raw.push({
          ts: at,
          meta: { monitorId, orgId, region },
          status,
          latencyMs,
          error: status === "down" ? "Timed out after 10000ms" : null,
          details:
            spec.check.type === "http" || spec.check.type === "keyword"
              ? { statusCode: status === "down" ? 503 : 200 }
              : {},
        });
      },
    );

    await MonitorModel.create({
      _id: monitorId,
      ...spec,
      orgId,
      managedBy: index < 6 ? "config" : "ui",
      state: liveState(spec, demo, now, random),
      createdAt: new Date(now.getTime() - (HISTORY_DAYS + 5) * DAY),
    });
    const docs = rollupDocs(monitorId, orgId, buckets);
    await RollupModel.collection.insertMany(docs, { ordered: false });
    if (raw.length > 0) await CheckResultModel.collection.insertMany(raw, { ordered: false });
    rollupCount += docs.length;
    rawCount += raw.length;
  }

  for (const input of DEMO_SLOS) {
    const spec = SloSpecSchema.parse(input);
    const monitorId = monitorIds.get(spec.monitor);
    if (!monitorId) continue;
    await SloModel.create({
      orgId,
      monitorId,
      key: spec.key,
      name: spec.name,
      target: spec.target,
      windowDays: spec.windowDays,
      managedBy: "config",
      lastEvaluation: null,
    });
  }

  const channels = new Map<string, Types.ObjectId>();
  for (const input of demoChannels(env.CHAOS_URL)) {
    const spec = ChannelSpecSchema.parse(input);
    const channel = await ChannelModel.create({ ...spec, orgId, managedBy: "config" });
    channels.set(spec.key, channel._id);
  }

  const notifications: Record<string, unknown>[] = [];
  const notify = (
    channelKey: string,
    incidentId: Types.ObjectId | null,
    monitorKey: string,
    event: string,
    subject: string,
    at: Date,
    status: NotificationStatus,
    reason: string | null = null,
  ) => {
    const channelId = channels.get(channelKey);
    if (!channelId) return;
    notifications.push({
      orgId,
      channelId,
      incidentId,
      monitorId: monitorIds.get(monitorKey) ?? null,
      event,
      dedupKey: `seed:${notifications.length}`,
      subject,
      body: subject,
      severity: event === "incident.resolved" ? "resolved" : "critical",
      url: null,
      fields: [],
      status,
      reason,
      attempts: status === "skipped" || status === "suppressed" ? 0 : 1,
      deliverAfter: at,
      deliveredAt: status === "sent" ? at : null,
      createdAt: at,
      updatedAt: at,
    });
  };

  for (const demo of DEMO_INCIDENTS) {
    const monitorId = monitorIds.get(demo.monitor);
    if (!monitorId) continue;
    const startedAt = new Date(now.getTime() - demo.startedAgoMs);
    const last = demo.timeline.at(-1);
    const resolvedAt = last ? new Date(startedAt.getTime() + last.afterMs) : null;
    const incidentId = new Types.ObjectId();
    await IncidentModel.collection.insertOne({
      _id: incidentId,
      orgId,
      title: demo.title,
      status: "resolved",
      impact: demo.impact,
      automated: demo.automated,
      autoResolve: demo.automated,
      monitorIds: [monitorId],
      startedAt,
      statusChangedAt: resolvedAt ?? startedAt,
      resolvedAt,
      createdAt: startedAt,
      updatedAt: resolvedAt ?? startedAt,
    });
    await IncidentUpdateModel.collection.insertMany(
      demo.timeline.map((entry) => ({
        incidentId,
        orgId,
        status: entry.status,
        message: entry.message,
        author: entry.author,
        automated: entry.author === "Beacon",
        createdAt: new Date(startedAt.getTime() + entry.afterMs),
      })),
    );

    const opened = `[Incident] ${demo.title}`;
    const resolved = `[Resolved] ${demo.title}`;
    notify("oncall-email", incidentId, demo.monitor, "incident.opened", opened, startedAt, "sent");
    notify("incidents-slack", incidentId, demo.monitor, "incident.opened", opened, startedAt, "sent");
    if (["checkout-api", "storefront"].includes(demo.monitor)) {
      notify("ops-discord", incidentId, demo.monitor, "incident.opened", opened, startedAt, "sent");
    }
    if (demo.durationMs > 2 * MINUTE) {
      notify(
        "pager-bridge",
        incidentId,
        demo.monitor,
        "incident.opened",
        opened,
        new Date(startedAt.getTime() + 2 * MINUTE),
        "sent",
      );
    } else {
      notify(
        "pager-bridge",
        incidentId,
        demo.monitor,
        "incident.opened",
        opened,
        startedAt,
        "skipped",
        "Resolved before the 120s escalation delay elapsed",
      );
    }
    if (resolvedAt) {
      notify("oncall-email", incidentId, demo.monitor, "incident.resolved", resolved, resolvedAt, "sent");
      notify("incidents-slack", incidentId, demo.monitor, "incident.resolved", resolved, resolvedAt, "sent");
    }
  }

  const upgradeStart = new Date(floorTo(new Date(now.getTime() - 20 * DAY), "1h").getTime() + 2 * HOUR);
  await MaintenanceModel.create([
    {
      orgId,
      title: "Session cache version upgrade",
      description: "Rolling upgrade of the Redis cluster. Logins may briefly require a second attempt.",
      startsAt: upgradeStart,
      endsAt: new Date(upgradeStart.getTime() + HOUR),
      monitors: ["session-cache"],
    },
    {
      orgId,
      title: "Database failover drill",
      description:
        "Planned failover of the primary database to verify our recovery runbook. No downtime expected.",
      startsAt: new Date(floorTo(new Date(now.getTime() + 3 * DAY), "1h").getTime() + 2 * HOUR),
      endsAt: new Date(floorTo(new Date(now.getTime() + 3 * DAY), "1h").getTime() + 3 * HOUR),
      monitors: ["primary-database"],
    },
  ]);
  notify(
    "incidents-slack",
    null,
    "session-cache",
    "monitor.degraded",
    "[Degraded] Session cache",
    new Date(upgradeStart.getTime() + 12 * MINUTE),
    "suppressed",
    "maintenance: Session cache version upgrade",
  );
  if (notifications.length > 0) await NotificationModel.collection.insertMany(notifications);

  logger.info(
    { org: env.DEMO_ORG_SLUG, monitors: demos.length, rollups: rollupCount, rawResults: rawCount },
    "seeded demo organization",
  );
  logger.info(`API key: ${env.DEMO_API_KEY}`);
}

try {
  await main();
} finally {
  await disconnectMongo();
}
