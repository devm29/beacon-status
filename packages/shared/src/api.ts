import { z } from "zod";
import { AlertEventSchema, ChannelTargetSchema } from "./channel.js";
import { StatusPageSpecSchema } from "./config.js";
import { MonitorStatusSchema } from "./events.js";
import { IncidentImpactSchema, IncidentStatusSchema } from "./incident.js";
import { CheckSchema, KeySchema } from "./monitor.js";
import { RegionSchema } from "./regions.js";
import { CheckStatusSchema } from "./results.js";

const IsoDate = z.iso.datetime();

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const RegionStatusDtoSchema = z.object({
  region: RegionSchema,
  status: CheckStatusSchema,
  latencyMs: z.number(),
  error: z.string().nullable(),
  at: IsoDate,
  stale: z.boolean(),
});
export type RegionStatusDto = z.infer<typeof RegionStatusDtoSchema>;

export const MonitorDtoSchema = z.object({
  id: z.string(),
  key: KeySchema,
  name: z.string(),
  description: z.string(),
  group: z.string(),
  check: CheckSchema,
  intervalSeconds: z.number(),
  timeoutMs: z.number(),
  regions: z.array(RegionSchema),
  quorum: z.number(),
  failThreshold: z.number(),
  recoverThreshold: z.number(),
  degradedLatencyMs: z.number().nullable(),
  public: z.boolean(),
  paused: z.boolean(),
  managedBy: z.enum(["config", "ui"]),
  status: MonitorStatusSchema,
  statusSince: IsoDate.nullable(),
  flapping: z.boolean(),
  lastCheckedAt: IsoDate.nullable(),
  regionStatus: z.array(RegionStatusDtoSchema),
  inMaintenance: z.boolean(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type MonitorDto = z.infer<typeof MonitorDtoSchema>;

export const MonitorStatsDtoSchema = z.object({
  monitorId: z.string(),
  uptime24h: z.number().nullable(),
  uptime30d: z.number().nullable(),
  p95Ms24h: z.number().nullable(),
  avgMs24h: z.number().nullable(),
  sparkline: z.array(z.object({ t: IsoDate, avgMs: z.number().nullable() })),
});
export type MonitorStatsDto = z.infer<typeof MonitorStatsDtoSchema>;

export const OverviewDtoSchema = z.object({
  totals: z.object({
    monitors: z.number(),
    up: z.number(),
    degraded: z.number(),
    down: z.number(),
    paused: z.number(),
    pending: z.number(),
  }),
  openIncidents: z.number(),
  uptime30d: z.number().nullable(),
  avgLatency24h: z.number().nullable(),
  checks24h: z.number(),
  monitors: z.array(z.object({ monitor: MonitorDtoSchema, stats: MonitorStatsDtoSchema })),
});
export type OverviewDto = z.infer<typeof OverviewDtoSchema>;

export const CheckResultDtoSchema = z.object({
  id: z.string(),
  region: RegionSchema,
  status: CheckStatusSchema,
  latencyMs: z.number(),
  error: z.string().nullable(),
  statusCode: z.number().nullable(),
  checkedAt: IsoDate,
});
export type CheckResultDto = z.infer<typeof CheckResultDtoSchema>;
export const CheckResultPageSchema = pageOf(CheckResultDtoSchema);

export const METRIC_RANGES = ["1h", "24h", "7d", "30d", "90d"] as const;
export const MetricRangeSchema = z.enum(METRIC_RANGES);
export type MetricRange = z.infer<typeof MetricRangeSchema>;

export const MetricPointSchema = z.object({
  t: IsoDate,
  total: z.number(),
  up: z.number(),
  degraded: z.number(),
  down: z.number(),
  uptime: z.number().nullable(),
  avgMs: z.number().nullable(),
  p50Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
  p99Ms: z.number().nullable(),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export const MetricsDtoSchema = z.object({
  range: MetricRangeSchema,
  granularity: z.enum(["1m", "1h", "1d"]),
  points: z.array(MetricPointSchema),
});
export type MetricsDto = z.infer<typeof MetricsDtoSchema>;

export const IncidentUpdateDtoSchema = z.object({
  id: z.string(),
  status: IncidentStatusSchema,
  message: z.string(),
  author: z.string(),
  automated: z.boolean(),
  createdAt: IsoDate,
});
export type IncidentUpdateDto = z.infer<typeof IncidentUpdateDtoSchema>;

export const IncidentDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: IncidentStatusSchema,
  impact: IncidentImpactSchema,
  automated: z.boolean(),
  autoResolve: z.boolean(),
  monitors: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })),
  startedAt: IsoDate,
  statusChangedAt: IsoDate,
  resolvedAt: IsoDate.nullable(),
  updates: z.array(IncidentUpdateDtoSchema),
});
export type IncidentDto = z.infer<typeof IncidentDtoSchema>;
export const IncidentPageSchema = pageOf(IncidentDtoSchema);

export const CreateIncidentInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  impact: IncidentImpactSchema.default("minor"),
  status: IncidentStatusSchema.exclude(["resolved"]).default("investigating"),
  message: z.string().trim().min(1).max(2000),
  monitorIds: z.array(z.string()).max(50).default([]),
});
export type CreateIncidentInput = z.input<typeof CreateIncidentInputSchema>;

export const IncidentUpdateInputSchema = z.object({
  status: IncidentStatusSchema,
  message: z.string().trim().min(1).max(2000),
  impact: IncidentImpactSchema.optional(),
  autoResolve: z.boolean().optional(),
});
export type IncidentUpdateInput = z.input<typeof IncidentUpdateInputSchema>;

export const BurnWindowDtoSchema = z.object({
  name: z.string(),
  severity: z.enum(["page", "ticket"]),
  longWindowMinutes: z.number(),
  shortWindowMinutes: z.number(),
  threshold: z.number(),
  longBurn: z.number(),
  shortBurn: z.number(),
  firing: z.boolean(),
});

export const SloDtoSchema = z.object({
  id: z.string(),
  key: KeySchema,
  name: z.string(),
  monitor: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  target: z.number(),
  windowDays: z.number(),
  managedBy: z.enum(["config", "ui"]),
  sli: z.number().nullable(),
  budgetRemaining: z.number(),
  firing: z.boolean(),
});
export type SloDto = z.infer<typeof SloDtoSchema>;

export const SloReportDtoSchema = z.object({
  slo: SloDtoSchema,
  totals: z.object({ good: z.number(), total: z.number(), bad: z.number(), allowedBad: z.number() }),
  burn: z.array(BurnWindowDtoSchema),
  burndown: z.array(z.object({ date: z.string(), sli: z.number().nullable(), remaining: z.number() })),
  burnSeries: z.array(z.object({ t: IsoDate, burn: z.number() })),
});
export type SloReportDto = z.infer<typeof SloReportDtoSchema>;

export const ChannelDtoSchema = z.object({
  id: z.string(),
  key: KeySchema,
  name: z.string(),
  enabled: z.boolean(),
  target: ChannelTargetSchema,
  hasSecret: z.boolean(),
  events: z.array(AlertEventSchema),
  monitors: z.array(z.string()),
  escalationDelaySeconds: z.number(),
  managedBy: z.enum(["config", "ui"]),
  lastDelivery: z
    .object({
      status: z.enum(["sent", "failed", "suppressed", "skipped"]),
      at: IsoDate,
      error: z.string().nullable(),
    })
    .nullable(),
});
export type ChannelDto = z.infer<typeof ChannelDtoSchema>;

export const NotificationDtoSchema = z.object({
  id: z.string(),
  channel: z.object({ id: z.string(), name: z.string(), type: z.string() }),
  event: AlertEventSchema,
  status: z.enum(["pending", "sent", "failed", "suppressed", "skipped"]),
  reason: z.string().nullable(),
  subject: z.string(),
  attempts: z.number(),
  createdAt: IsoDate,
});
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

export const MaintenanceInputSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(1000).default(""),
    startsAt: IsoDate,
    endsAt: IsoDate,
    monitors: z.array(KeySchema).default([]),
  })
  .refine((m) => new Date(m.endsAt).getTime() > new Date(m.startsAt).getTime(), {
    path: ["endsAt"],
    message: "The window must end after it starts",
  });
export type MaintenanceInput = z.input<typeof MaintenanceInputSchema>;

export const MaintenanceDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  startsAt: IsoDate,
  endsAt: IsoDate,
  monitors: z.array(z.string()),
  state: z.enum(["scheduled", "active", "completed"]),
});
export type MaintenanceDto = z.infer<typeof MaintenanceDtoSchema>;

export const OVERALL_STATUSES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;
export const OverallStatusSchema = z.enum(OVERALL_STATUSES);
export type OverallStatus = z.infer<typeof OverallStatusSchema>;

export const UptimeDayDtoSchema = z.object({
  date: z.string(),
  uptime: z.number().nullable(),
  total: z.number(),
  down: z.number(),
  level: z.enum(["operational", "degraded", "partial", "major", "nodata"]),
  incidents: z.array(z.object({ id: z.string(), title: z.string(), impact: IncidentImpactSchema })),
});

export const PublicComponentSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["operational", "degraded", "outage", "maintenance", "unknown"]),
  uptime90d: z.number().nullable(),
  days: z.array(UptimeDayDtoSchema),
});
export type PublicComponent = z.infer<typeof PublicComponentSchema>;

export const PublicIncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: IncidentStatusSchema,
  impact: IncidentImpactSchema,
  startedAt: IsoDate,
  resolvedAt: IsoDate.nullable(),
  components: z.array(z.string()),
  updates: z.array(
    z.object({ id: z.string(), status: IncidentStatusSchema, message: z.string(), createdAt: IsoDate }),
  ),
});
export type PublicIncident = z.infer<typeof PublicIncidentSchema>;

export const PublicStatusDtoSchema = z.object({
  org: z.object({ name: z.string(), slug: z.string() }),
  page: StatusPageSpecSchema,
  overall: OverallStatusSchema,
  groups: z.array(z.object({ name: z.string(), components: z.array(PublicComponentSchema) })),
  activeIncidents: z.array(PublicIncidentSchema),
  recentIncidents: z.array(PublicIncidentSchema),
  maintenance: z.array(
    MaintenanceDtoSchema.omit({ monitors: true }).extend({ components: z.array(z.string()) }),
  ),
  generatedAt: IsoDate,
});
export type PublicStatusDto = z.infer<typeof PublicStatusDtoSchema>;

export const PublicComponentStatusSchema = PublicComponentSchema.shape.status;

export const RealtimeTokenDtoSchema = z.object({ token: z.string(), expiresAt: IsoDate });

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
