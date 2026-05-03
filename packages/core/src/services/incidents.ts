import {
  DEFAULT_AUTOMATION_POLICY,
  INCIDENT_STATUS_LABELS,
  assertTransition,
  decideAutomation,
  type AutomationPolicy,
  type AutomationSignal,
  type IncidentImpact,
  type IncidentStatus,
} from "@beacon/shared";
import type { Types } from "mongoose";
import type { EventPublisher } from "../event-bus.js";
import type { Logger } from "../logger.js";
import {
  IncidentModel,
  IncidentUpdateModel,
  MonitorModel,
  type IncidentDoc,
  type IncidentUpdateDoc,
  type MonitorDoc,
} from "../models/index.js";
import type { AlertDispatcher } from "./alerts.js";

export const SYSTEM_AUTHOR = "Beacon";

export interface IncidentWithUpdates extends IncidentDoc {
  updates: IncidentUpdateDoc[];
}

export interface ManualIncidentInput {
  title: string;
  impact: IncidentImpact;
  status: Exclude<IncidentStatus, "resolved">;
  message: string;
  monitorIds: Types.ObjectId[];
}

export interface ManualUpdateInput {
  status: IncidentStatus;
  message: string;
  impact?: IncidentImpact | undefined;
  autoResolve?: boolean | undefined;
}

export interface IncidentListQuery {
  status?: "open" | "resolved" | undefined;
  limit: number;
  /** Keyset pagination: rows strictly after this (startedAt, _id) in newest-first order. */
  before?: { date: Date; id: Types.ObjectId } | undefined;
}

type MonitorRef = Pick<MonitorDoc, "_id" | "orgId" | "key" | "name">;
type AnnouncedMonitor = Pick<MonitorDoc, "_id" | "key" | "name" | "public">;
type Change = "opened" | "updated" | "resolved";

/** How long a flapping monitor's incident may stay open before its page is sent anyway. */
export const DEFAULT_FLAPPING_PAGE_DELAY_MS = 10 * 60_000;

export class IncidentNotFoundError extends Error {
  override name = "IncidentNotFoundError";
}

/**
 * Owns incident lifecycle for both automation (driven by the evaluator) and humans (driven by the
 * API). Every status change writes a timeline entry, emits a realtime event and alerts channels.
 */
export class IncidentService {
  constructor(
    private readonly deps: {
      events: EventPublisher;
      alerts: AlertDispatcher;
      logger: Logger;
      dashboardUrl: string;
      policy?: AutomationPolicy;
      flappingPageDelayMs?: number;
    },
  ) {}

  private get policy(): AutomationPolicy {
    return this.deps.policy ?? DEFAULT_AUTOMATION_POLICY;
  }

  async findOpenForMonitor(monitorId: Types.ObjectId): Promise<IncidentDoc | null> {
    return IncidentModel.findOne({ monitorIds: monitorId, status: { $ne: "resolved" } })
      .sort({ startedAt: -1 })
      .lean<IncidentDoc>()
      .exec();
  }

  /** Whether any incident for the monitor is open, or was resolved after `since`. */
  async hasIncidentSince(monitorId: Types.ObjectId, since: Date): Promise<boolean> {
    const found = await IncidentModel.exists({
      monitorIds: monitorId,
      $or: [{ status: { $ne: "resolved" } }, { resolvedAt: { $gte: since } }],
    }).exec();
    return found !== null;
  }

  async findLatestAutomated(monitorId: Types.ObjectId): Promise<IncidentDoc | null> {
    return IncidentModel.findOne({ monitorIds: monitorId, automated: true })
      .sort({ startedAt: -1 })
      .lean<IncidentDoc>()
      .exec();
  }

  async onMonitorDown(
    monitor: MonitorRef,
    context: { votes: string; detail: string; flapping: boolean },
    now: Date,
  ): Promise<IncidentDoc> {
    const signal: AutomationSignal = {
      kind: "monitor_down",
      monitorName: monitor.name,
      votes: context.votes,
    };
    const open = await this.findOpenForMonitor(monitor._id);
    if (open) {
      await this.applyAutomation(open, signal, now, context.flapping);
      return open;
    }

    const latest = await this.findLatestAutomated(monitor._id);
    if (latest && latest.status === "resolved") {
      const reopened = await this.applyAutomation(latest, signal, now, context.flapping);
      if (reopened) return reopened;
    }

    const incident = await IncidentModel.create({
      orgId: monitor.orgId,
      title: `${monitor.name} is unavailable`,
      status: "investigating",
      impact: "major",
      automated: true,
      autoResolve: true,
      monitorIds: [monitor._id],
      startedAt: now,
      statusChangedAt: now,
      resolvedAt: null,
    });
    const doc = incident.toObject<IncidentDoc>();
    await this.writeUpdate(
      doc,
      "investigating",
      `Automated checks detected that ${monitor.name} is failing from ${context.votes}. ${context.detail} We are investigating.`,
      SYSTEM_AUTHOR,
      true,
      now,
    );
    await this.announce(doc, "opened", context.flapping ? "flapping" : null, now);
    this.deps.logger.info({ incidentId: doc._id.toHexString(), monitor: monitor.key }, "incident opened");
    return doc;
  }

  async onMonitorRecovered(monitor: MonitorRef, now: Date): Promise<void> {
    const open = await this.findOpenForMonitor(monitor._id);
    if (!open?.automated) return;
    await this.applyAutomation(open, { kind: "monitor_recovered", monitorName: monitor.name }, now, false);
  }

  async onMonitorStable(monitor: MonitorRef, now: Date, flapping: boolean): Promise<void> {
    if (flapping) return;
    const open = await this.findOpenForMonitor(monitor._id);
    if (!open?.automated || open.status !== "monitoring") return;
    await this.applyAutomation(open, { kind: "stable", monitorName: monitor.name }, now, false);
  }

  private async applyAutomation(
    incident: IncidentDoc,
    signal: AutomationSignal,
    now: Date,
    flapping: boolean,
  ): Promise<IncidentDoc | null> {
    const decision = decideAutomation(incident, signal, this.policy, now);
    if (!decision) return null;
    const updated = await this.transition(incident, decision.status, now);
    if (!updated) return null;
    await this.writeUpdate(updated, decision.status, decision.message, SYSTEM_AUTHOR, true, now);
    const change: Change =
      decision.status === "resolved" ? "resolved" : incident.status === "resolved" ? "opened" : "updated";
    await this.announce(updated, change, flapping ? "flapping" : null, now, decision.message);
    return updated;
  }

  /** Conditional on the current status so two evaluators cannot both apply the same transition. */
  private async transition(
    incident: IncidentDoc,
    to: IncidentStatus,
    now: Date,
  ): Promise<IncidentDoc | null> {
    assertTransition(incident.status, to);
    const set: Partial<IncidentDoc> = { status: to };
    if (to !== incident.status) set.statusChangedAt = now;
    if (to === "resolved") {
      set.resolvedAt = now;
      set.pageDeferred = false;
    }
    if (incident.status === "resolved" && to !== "resolved") set.resolvedAt = null;
    return IncidentModel.findOneAndUpdate(
      { _id: incident._id, status: incident.status },
      { $set: set },
      { new: true },
    )
      .lean<IncidentDoc>()
      .exec();
  }

  private async writeUpdate(
    incident: IncidentDoc,
    status: IncidentStatus,
    message: string,
    author: string,
    automated: boolean,
    now: Date,
  ): Promise<IncidentUpdateDoc> {
    const update = await IncidentUpdateModel.create({
      incidentId: incident._id,
      orgId: incident.orgId,
      status,
      message,
      author,
      automated,
      createdAt: now,
    });
    return update.toObject<IncidentUpdateDoc>();
  }

  private async announce(
    incident: IncidentDoc,
    change: Change,
    suppressReason: string | null,
    now: Date,
    message?: string,
    options: { dedupSuffix?: string } = {},
  ): Promise<void> {
    const monitors =
      incident.monitorIds.length === 0
        ? []
        : await MonitorModel.find({ _id: { $in: incident.monitorIds } }, { key: 1, name: 1, public: 1 })
            .lean<AnnouncedMonitor[]>()
            .exec();
    await this.deps.events.publish({
      type: "incident.changed",
      orgId: incident.orgId.toHexString(),
      incidentId: incident._id.toHexString(),
      change,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
      public: incident.monitorIds.length === 0 || monitors.some((m) => m.public),
      at: now.toISOString(),
    });

    const event =
      change === "opened"
        ? "incident.opened"
        : change === "resolved"
          ? "incident.resolved"
          : "incident.updated";
    const statusLabel = INCIDENT_STATUS_LABELS[incident.status];
    const [primary] = monitors;
    await this.deps.alerts.dispatch(
      {
        event,
        orgId: incident.orgId,
        monitors: monitors.map((m) => ({ id: m._id, key: m.key, name: m.name })),
        incidentId: incident._id,
        subject:
          change === "opened"
            ? `[Incident] ${incident.title}`
            : change === "resolved"
              ? `[Resolved] ${incident.title}`
              : `[${statusLabel}] ${incident.title}`,
        body: message ?? `${incident.title}. Status: ${statusLabel}.`,
        severity:
          change === "resolved"
            ? "resolved"
            : incident.impact === "critical" || incident.impact === "major"
              ? "critical"
              : "warning",
        url: `${this.deps.dashboardUrl}/incidents/${incident._id.toHexString()}`,
        fields: [
          { label: "Status", value: statusLabel },
          { label: "Impact", value: incident.impact },
          ...(primary ? [{ label: "Monitor", value: primary.name }] : []),
        ],
        // statusChangedAt tells a reopen apart from the original opening of the same incident.
        dedupKey: `incident:${incident._id.toHexString()}:${change}:${incident.status}:${incident.statusChangedAt.getTime()}${options.dedupSuffix ?? ""}`,
        dedupWindowSeconds: change === "updated" ? 60 : 15 * 60,
        suppressReason,
      },
      now,
    );

    if (change === "opened" && suppressReason === "flapping") {
      await IncidentModel.updateOne({ _id: incident._id }, { $set: { pageDeferred: true } }).exec();
    }
  }

  /**
   * Opening pages are held back while a monitor flaps so on-call is not paged every few minutes.
   * Once flapping stops, or the incident has been open too long to be noise, the page goes out.
   */
  async releaseDeferredPages(
    now: Date,
    resolveMonitors: (ids: Types.ObjectId[]) => Promise<MonitorDoc[]>,
  ): Promise<number> {
    const delayMs = this.deps.flappingPageDelayMs ?? DEFAULT_FLAPPING_PAGE_DELAY_MS;
    const deferred = await IncidentModel.find({ pageDeferred: true, status: { $ne: "resolved" } })
      .lean<IncidentDoc[]>()
      .exec();
    let released = 0;
    for (const incident of deferred) {
      const monitors = await resolveMonitors(incident.monitorIds);
      const stillFlapping = monitors.some((m) => m.state.flapping);
      if (stillFlapping && now.getTime() - incident.statusChangedAt.getTime() < delayMs) continue;
      const claimed = await IncidentModel.findOneAndUpdate(
        { _id: incident._id, pageDeferred: true },
        { $set: { pageDeferred: false } },
        { new: true },
      )
        .lean<IncidentDoc>()
        .exec();
      if (!claimed || claimed.status === "resolved") continue;
      const names = monitors.map((m) => m.name).join(", ") || claimed.title;
      await this.announce(
        claimed,
        "opened",
        null,
        now,
        `${names} has kept failing while flapping since ${claimed.statusChangedAt.toISOString()}. Paging now that it is not recovering on its own.`,
        { dedupSuffix: ":deferred" },
      );
      released += 1;
    }
    return released;
  }

  /** Resolves monitoring incidents whose cool-down elapsed even if no new results arrive. */
  async sweep(now: Date, resolveMonitors: (ids: Types.ObjectId[]) => Promise<MonitorDoc[]>): Promise<number> {
    const candidates = await IncidentModel.find({ status: "monitoring", automated: true, autoResolve: true })
      .lean<IncidentDoc[]>()
      .exec();
    let resolved = 0;
    for (const incident of candidates) {
      const monitors = await resolveMonitors(incident.monitorIds);
      const healthy = monitors.every(
        (m) => m.paused || m.state.status === "up" || m.state.status === "degraded",
      );
      const flapping = monitors.some((m) => m.state.flapping);
      if (!healthy || flapping) continue;
      const name = monitors[0]?.name ?? incident.title;
      const decision = decideAutomation(incident, { kind: "stable", monitorName: name }, this.policy, now);
      if (!decision) continue;
      const updated = await this.transition(incident, decision.status, now);
      if (!updated) continue;
      await this.writeUpdate(updated, decision.status, decision.message, SYSTEM_AUTHOR, true, now);
      await this.announce(updated, "resolved", null, now, decision.message);
      resolved += 1;
    }
    return resolved;
  }

  async createManual(
    orgId: Types.ObjectId,
    input: ManualIncidentInput,
    author: string,
    now = new Date(),
  ): Promise<IncidentDoc> {
    const incident = await IncidentModel.create({
      orgId,
      title: input.title,
      status: input.status,
      impact: input.impact,
      automated: false,
      autoResolve: false,
      monitorIds: input.monitorIds,
      startedAt: now,
      statusChangedAt: now,
      resolvedAt: null,
    });
    const doc = incident.toObject<IncidentDoc>();
    await this.writeUpdate(doc, input.status, input.message, author, false, now);
    await this.announce(doc, "opened", null, now, input.message);
    return doc;
  }

  async addManualUpdate(
    orgId: Types.ObjectId,
    incidentId: Types.ObjectId,
    input: ManualUpdateInput,
    author: string,
    now = new Date(),
  ): Promise<IncidentDoc> {
    const incident = await IncidentModel.findOne({ _id: incidentId, orgId }).lean<IncidentDoc>().exec();
    if (!incident) throw new IncidentNotFoundError("Incident not found");
    assertTransition(incident.status, input.status);

    let updated =
      incident.status === input.status ? incident : await this.transition(incident, input.status, now);
    if (!updated) throw new Error("The incident changed while you were editing it. Reload and try again.");
    const extra: Partial<IncidentDoc> = {};
    if (input.impact) extra.impact = input.impact;
    if (input.autoResolve !== undefined) extra.autoResolve = input.autoResolve;
    if (Object.keys(extra).length > 0) {
      updated =
        (await IncidentModel.findOneAndUpdate({ _id: incident._id }, { $set: extra }, { new: true })
          .lean<IncidentDoc>()
          .exec()) ?? updated;
    }
    await this.writeUpdate(updated, input.status, input.message, author, false, now);
    const change: Change =
      incident.status === input.status
        ? "updated"
        : input.status === "resolved"
          ? "resolved"
          : incident.status === "resolved"
            ? "opened"
            : "updated";
    await this.announce(updated, change, null, now, input.message);
    return updated;
  }

  async list(orgId: Types.ObjectId, query: IncidentListQuery): Promise<IncidentWithUpdates[]> {
    const filter: Record<string, unknown> = { orgId };
    if (query.status === "open") filter.status = { $ne: "resolved" };
    if (query.status === "resolved") filter.status = "resolved";
    if (query.before) {
      filter.$or = [
        { startedAt: { $lt: query.before.date } },
        { startedAt: query.before.date, _id: { $lt: query.before.id } },
      ];
    }
    const incidents = await IncidentModel.find(filter)
      .sort({ startedAt: -1, _id: -1 })
      .limit(query.limit)
      .lean<IncidentDoc[]>()
      .exec();
    return this.withUpdates(incidents);
  }

  async get(orgId: Types.ObjectId, id: Types.ObjectId): Promise<IncidentWithUpdates | null> {
    const incident = await IncidentModel.findOne({ _id: id, orgId }).lean<IncidentDoc>().exec();
    if (!incident) return null;
    const [withUpdates] = await this.withUpdates([incident]);
    return withUpdates ?? null;
  }

  async withUpdates(incidents: IncidentDoc[]): Promise<IncidentWithUpdates[]> {
    if (incidents.length === 0) return [];
    const updates = await IncidentUpdateModel.find({ incidentId: { $in: incidents.map((i) => i._id) } })
      .sort({ createdAt: -1 })
      .lean<IncidentUpdateDoc[]>()
      .exec();
    const byIncident = new Map<string, IncidentUpdateDoc[]>();
    for (const update of updates) {
      const key = update.incidentId.toHexString();
      byIncident.set(key, [...(byIncident.get(key) ?? []), update]);
    }
    return incidents.map((incident) => ({
      ...incident,
      updates: byIncident.get(incident._id.toHexString()) ?? [],
    }));
  }
}
