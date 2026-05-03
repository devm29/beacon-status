import { z } from "zod";
import { ChannelSpecSchema, type ChannelSpec } from "./channel.js";
import { MonitorSpecSchema, type MonitorSpec } from "./monitor.js";
import { SloSpecSchema, type SloSpec } from "./slo.js";

export const StatusPageSpecSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280).default(""),
  /** Display order of component groups on the public page; unknown groups are appended. */
  groups: z.array(z.string().trim().min(1).max(60)).default([]),
  supportUrl: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .default(null),
});
export type StatusPageSpec = z.infer<typeof StatusPageSpecSchema>;

function uniqueKeys<T extends { key: string }>(items: T[], ctx: z.RefinementCtx, path: string): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.key)) {
      ctx.addIssue({ code: "custom", path: [path, index, "key"], message: `Duplicate key "${item.key}"` });
    }
    seen.add(item.key);
  });
}

export const BeaconConfigSchema = z
  .object({
    version: z.literal(1),
    statusPage: StatusPageSpecSchema.optional(),
    monitors: z.array(MonitorSpecSchema).default([]),
    slos: z.array(SloSpecSchema).default([]),
    channels: z.array(ChannelSpecSchema).default([]),
  })
  .strict()
  .superRefine((config, ctx) => {
    uniqueKeys(config.monitors, ctx, "monitors");
    uniqueKeys(config.slos, ctx, "slos");
    uniqueKeys(config.channels, ctx, "channels");
    const monitorKeys = new Set(config.monitors.map((m) => m.key));
    config.slos.forEach((slo, index) => {
      if (!monitorKeys.has(slo.monitor)) {
        ctx.addIssue({
          code: "custom",
          path: ["slos", index, "monitor"],
          message: `SLO "${slo.key}" references unknown monitor "${slo.monitor}"`,
        });
      }
    });
    config.channels.forEach((channel, index) => {
      channel.monitors.forEach((key, monitorIndex) => {
        if (!monitorKeys.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["channels", index, "monitors", monitorIndex],
            message: `Channel "${channel.key}" references unknown monitor "${key}"`,
          });
        }
      });
    });
  });
export type BeaconConfig = z.infer<typeof BeaconConfigSchema>;
export type BeaconConfigInput = z.input<typeof BeaconConfigSchema>;

export type ResourceKind = "monitor" | "slo" | "channel" | "statusPage";
export type PlanAction = "create" | "update" | "delete" | "noop";

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface PlannedChange {
  kind: ResourceKind;
  key: string;
  action: PlanAction;
  changes: FieldChange[];
}

export interface Plan {
  changes: PlannedChange[];
  summary: Record<Exclude<PlanAction, "noop">, number>;
}

/** The server's view of resources, normalized to the same shape as the config file. */
export interface CurrentState {
  statusPage: StatusPageSpec;
  monitors: (MonitorSpec & { managedBy: "config" | "ui" })[];
  slos: (SloSpec & { managedBy: "config" | "ui" })[];
  channels: (ChannelSpec & { managedBy: "config" | "ui" })[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function diffValues(before: unknown, after: unknown, path = ""): FieldChange[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffValues(before[key], after[key], path ? `${path}.${key}` : key));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: path || "(root)", before, after }];
}

function planCollection<T extends { key: string }>(
  kind: ResourceKind,
  desired: readonly T[],
  current: readonly (T & { managedBy: "config" | "ui" })[],
  prune: boolean,
): PlannedChange[] {
  const currentByKey = new Map(current.map((c) => [c.key, c]));
  const changes: PlannedChange[] = desired.map((want) => {
    const have = currentByKey.get(want.key);
    if (!have) return { kind, key: want.key, action: "create", changes: diffValues(undefined, want) };
    const { managedBy, ...comparable } = have;
    const fieldChanges = diffValues(comparable, want);
    const adopt = managedBy !== "config";
    return {
      kind,
      key: want.key,
      action: fieldChanges.length > 0 || adopt ? "update" : "noop",
      changes: adopt
        ? [...fieldChanges, { path: "managedBy", before: managedBy, after: "config" }]
        : fieldChanges,
    };
  });

  if (prune) {
    const desiredKeys = new Set(desired.map((d) => d.key));
    for (const have of current) {
      if (have.managedBy === "config" && !desiredKeys.has(have.key)) {
        changes.push({ kind, key: have.key, action: "delete", changes: [] });
      }
    }
  }
  return changes;
}

/**
 * Computes what `apply` would do. Only resources previously created from config are deleted on
 * prune, so monitors someone created by hand in the dashboard are never removed by a sync.
 */
export function planConfig(desired: BeaconConfig, current: CurrentState, options: { prune: boolean }): Plan {
  const changes: PlannedChange[] = [];
  if (desired.statusPage) {
    const fieldChanges = diffValues(current.statusPage, desired.statusPage);
    changes.push({
      kind: "statusPage",
      key: "status-page",
      action: fieldChanges.length > 0 ? "update" : "noop",
      changes: fieldChanges,
    });
  }
  changes.push(
    ...planCollection("monitor", desired.monitors, current.monitors, options.prune),
    ...planCollection("slo", desired.slos, current.slos, options.prune),
    ...planCollection("channel", desired.channels, current.channels, options.prune),
  );
  const summary = { create: 0, update: 0, delete: 0 };
  for (const change of changes) {
    if (change.action !== "noop") summary[change.action] += 1;
  }
  return { changes, summary };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const PlanResponseSchema = z.object({
  plan: z.object({
    changes: z.array(
      z.object({
        kind: z.enum(["monitor", "slo", "channel", "statusPage"]),
        key: z.string(),
        action: z.enum(["create", "update", "delete", "noop"]),
        changes: z.array(
          z.object({ path: z.string(), before: z.unknown().optional(), after: z.unknown().optional() }),
        ),
      }),
    ),
    summary: z.object({ create: z.number(), update: z.number(), delete: z.number() }),
  }),
  planHash: z.string(),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;
