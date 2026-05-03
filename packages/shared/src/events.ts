import { z } from "zod";
import { IncidentImpactSchema, IncidentStatusSchema } from "./incident.js";
import { RegionSchema } from "./regions.js";
import { CheckStatusSchema } from "./results.js";
import { MONITOR_STATUSES } from "./evaluation.js";

export const MonitorStatusSchema = z.enum(MONITOR_STATUSES);

export const EVENTS_CHANNEL = "beacon:events";

export const CheckResultEventSchema = z.object({
  type: z.literal("check.result"),
  orgId: z.string(),
  monitorId: z.string(),
  region: RegionSchema,
  status: CheckStatusSchema,
  latencyMs: z.number(),
  error: z.string().nullable(),
  checkedAt: z.iso.datetime(),
});

export const MonitorStatusEventSchema = z.object({
  type: z.literal("monitor.status"),
  orgId: z.string(),
  monitorId: z.string(),
  monitorName: z.string(),
  public: z.boolean(),
  from: MonitorStatusSchema,
  to: MonitorStatusSchema,
  flapping: z.boolean(),
  at: z.iso.datetime(),
});

export const IncidentEventSchema = z.object({
  type: z.literal("incident.changed"),
  orgId: z.string(),
  incidentId: z.string(),
  change: z.enum(["opened", "updated", "resolved"]),
  title: z.string(),
  status: IncidentStatusSchema,
  impact: IncidentImpactSchema,
  /** False when every monitor the incident touches is hidden from the status page. */
  public: z.boolean(),
  at: z.iso.datetime(),
});

export const StatusPageEventSchema = z.object({
  type: z.literal("statuspage.changed"),
  orgId: z.string(),
  reason: z.enum(["config", "maintenance", "monitor"]),
  at: z.iso.datetime(),
});

export const RealtimeEventSchema = z.discriminatedUnion("type", [
  CheckResultEventSchema,
  MonitorStatusEventSchema,
  IncidentEventSchema,
  StatusPageEventSchema,
]);
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
export type CheckResultEvent = z.infer<typeof CheckResultEventSchema>;
export type MonitorStatusEvent = z.infer<typeof MonitorStatusEventSchema>;
export type IncidentEvent = z.infer<typeof IncidentEventSchema>;

/** Public status pages only ever see events that are safe to show anonymously. */
export function isPublicEvent(event: RealtimeEvent): boolean {
  switch (event.type) {
    case "check.result":
      return false;
    case "monitor.status":
    case "incident.changed":
      return event.public;
    case "statuspage.changed":
      return true;
  }
}
