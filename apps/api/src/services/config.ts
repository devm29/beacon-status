import { createHash } from "node:crypto";
import {
  ChannelModel,
  SloModel,
  monitorSpecOf,
  type ChannelDoc,
  type EventPublisher,
  type MonitorRepository,
  type OrgDoc,
  type OrgRepository,
  type SloDoc,
} from "@beacon/core";
import {
  BeaconConfigSchema,
  placeholderTarget,
  planConfig,
  stableStringify,
  type BeaconConfig,
  type CurrentState,
  type FieldChange,
  type Plan,
} from "@beacon/shared";
import { z } from "zod";
import { conflict } from "../http/errors.js";
import type { ChannelService } from "./channels.js";
import type { MonitorService } from "./monitors.js";
import type { SloApiService } from "./slos.js";

export const PlanRequestSchema = z.object({
  config: z.unknown(),
  prune: z.boolean().default(false),
});

export const ApplyRequestSchema = PlanRequestSchema.extend({
  /** When set, apply refuses to run if the server state drifted since this plan was computed. */
  planHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

const SENSITIVE_PATH = /(^|\.)target\.(url|secret|headers)(\.|$)/;

/** Plans are shown in terminals and CI logs, so webhook URLs and secrets never appear in them. */
function redactValue(path: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (SENSITIVE_PATH.test(path)) return "(sensitive)";
  if (Array.isArray(value)) return value.map((item, index) => redactValue(`${path}.${index}`, item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(path ? `${path}.${key}` : key, item)]),
    );
  }
  return value;
}

function redactChanges(changes: FieldChange[]): FieldChange[] {
  return changes.map((c) => {
    const base = c.path === "(root)" ? "" : c.path;
    return { path: c.path, before: redactValue(base, c.before), after: redactValue(base, c.after) };
  });
}

export interface PlanResult {
  plan: Plan;
  planHash: string;
}

/**
 * Monitoring-as-code: diffs a beacon.yaml document against the org's resources. The plan hash
 * covers both sides, so `apply --plan-hash` behaves like `terraform apply plan.out`.
 */
export class ConfigService {
  constructor(
    private readonly deps: {
      orgs: OrgRepository;
      monitors: MonitorRepository;
      monitorService: MonitorService;
      sloService: SloApiService;
      channelService: ChannelService;
      events: EventPublisher;
    },
  ) {}

  async currentState(org: OrgDoc): Promise<CurrentState> {
    const [monitors, slos, channels] = await Promise.all([
      this.deps.monitors.list(org._id),
      SloModel.find({ orgId: org._id }).lean<SloDoc[]>().exec(),
      ChannelModel.find({ orgId: org._id }).lean<ChannelDoc[]>().exec(),
    ]);
    const keyById = new Map(monitors.map((m) => [m._id.toHexString(), m.key]));
    return {
      statusPage: org.statusPage,
      monitors: monitors.map((m) => ({ ...monitorSpecOf(m), managedBy: m.managedBy })),
      slos: slos.flatMap((s) => {
        const monitor = keyById.get(s.monitorId.toHexString());
        return monitor
          ? [
              {
                key: s.key,
                name: s.name,
                monitor,
                target: s.target,
                windowDays: s.windowDays,
                managedBy: s.managedBy,
              },
            ]
          : [];
      }),
      channels: channels.map((c) => ({
        key: c.key,
        name: c.name,
        enabled: c.enabled,
        target: c.target,
        events: c.events,
        monitors: c.monitors,
        escalationDelaySeconds: c.escalationDelaySeconds,
        managedBy: c.managedBy,
      })),
    };
  }

  private hash(desired: BeaconConfig, current: CurrentState, prune: boolean): string {
    return createHash("sha256").update(stableStringify({ desired, current, prune })).digest("hex");
  }

  async plan(
    org: OrgDoc,
    rawConfig: unknown,
    prune: boolean,
  ): Promise<PlanResult & { desired: BeaconConfig }> {
    const desired = BeaconConfigSchema.parse(rawConfig);
    const current = await this.currentState(org);
    const plan = planConfig(desired, current, { prune });
    return {
      desired,
      plan: { ...plan, changes: plan.changes.map((c) => ({ ...c, changes: redactChanges(c.changes) })) },
      planHash: this.hash(desired, current, prune),
    };
  }

  async apply(
    org: OrgDoc,
    rawConfig: unknown,
    options: { prune: boolean; planHash?: string | undefined },
  ): Promise<PlanResult> {
    const { desired, plan, planHash } = await this.plan(org, rawConfig, options.prune);
    if (options.planHash && options.planHash !== planHash) {
      throw conflict("Server state changed since this plan was created. Run `beacon plan` again.");
    }

    if (desired.statusPage) await this.deps.orgs.updateStatusPage(org._id, desired.statusPage);

    const existing = new Map((await this.deps.monitors.list(org._id)).map((m) => [m.key, m]));
    for (const change of plan.changes.filter(
      (c) => c.kind === "monitor" && c.action !== "noop" && c.action !== "delete",
    )) {
      const spec = desired.monitors.find((m) => m.key === change.key);
      if (!spec) continue;
      const current = existing.get(spec.key);
      if (current) await this.deps.monitorService.replaceFromSpec(org, current._id, spec, "config");
      else await this.deps.monitorService.createFromSpec(org, spec, "config");
    }
    for (const change of plan.changes.filter(
      (c) => c.kind === "slo" && c.action !== "noop" && c.action !== "delete",
    )) {
      const spec = desired.slos.find((s) => s.key === change.key);
      if (spec) await this.deps.sloService.upsertFromSpec(org, spec, "config");
    }
    for (const change of plan.changes.filter(
      (c) => c.kind === "channel" && c.action !== "noop" && c.action !== "delete",
    )) {
      const spec = desired.channels.find((c) => c.key === change.key);
      if (spec) await this.deps.channelService.upsertFromSpec(org, spec, "config");
    }

    for (const change of plan.changes.filter((c) => c.action === "delete")) {
      if (change.kind === "slo") await SloModel.deleteOne({ orgId: org._id, key: change.key }).exec();
      if (change.kind === "channel") await ChannelModel.deleteOne({ orgId: org._id, key: change.key }).exec();
      if (change.kind === "monitor") {
        const monitor = existing.get(change.key);
        if (monitor) await this.deps.monitorService.deleteDoc(org, monitor);
      }
    }

    await this.deps.events.publish({
      type: "statuspage.changed",
      orgId: org._id.toHexString(),
      reason: "config",
      at: new Date().toISOString(),
    });
    return { plan, planHash };
  }

  /**
   * Channel credentials are exported as `${CHANNEL_<KEY>_URL}`-style placeholders that the CLI
   * fills from the environment. Applied as-is, they fail validation, so an export can be
   * round-tripped without ever overwriting a real webhook URL with a masked one.
   */
  async export(org: OrgDoc): Promise<BeaconConfig> {
    const current = await this.currentState(org);
    const strip = <T extends { managedBy: unknown }>({ managedBy: _m, ...rest }: T) => rest;
    return {
      version: 1,
      statusPage: current.statusPage,
      monitors: current.monitors.map(strip),
      slos: current.slos.map(strip),
      channels: current.channels.map((c) => ({ ...strip(c), target: placeholderTarget(c.key, c.target) })),
    };
  }
}
