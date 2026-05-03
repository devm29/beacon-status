import {
  toObjectId,
  type AlertDispatcher,
  type EventPublisher,
  type IncidentService,
  type Logger,
  type MaintenanceRepository,
  type MonitorDoc,
  type MonitorRepository,
  type ResultJobData,
} from "@beacon/core";
import {
  REGION_LABELS,
  evaluate,
  tallyVotes,
  type EvaluationOutcome,
  type EvaluationPolicy,
  type MonitorState,
  type PendingReaction,
} from "@beacon/shared";

export interface FlapPolicy {
  flapWindowMs: number;
  flapThreshold: number;
}

export interface EvaluationDeps {
  monitors: MonitorRepository;
  incidents: IncidentService;
  alerts: AlertDispatcher;
  maintenance: MaintenanceRepository;
  events: EventPublisher;
  logger: Logger;
  flap: FlapPolicy;
  dashboardUrl: string;
  now?: () => Date;
}

const MAX_CAS_ATTEMPTS = 8;

export function policyFor(monitor: MonitorDoc, flap: FlapPolicy): EvaluationPolicy {
  return {
    regions: monitor.regions,
    quorum: monitor.quorum,
    failThreshold: monitor.failThreshold,
    recoverThreshold: monitor.recoverThreshold,
    intervalSeconds: monitor.intervalSeconds,
    flapWindowMs: flap.flapWindowMs,
    flapThreshold: flap.flapThreshold,
  };
}

function summarizeFailures(state: MonitorState): string {
  const failures = Object.entries(state.regions)
    .filter(([, o]) => o.status === "down" && o.error)
    .map(([region, o]) => `${REGION_LABELS[region as keyof typeof REGION_LABELS] ?? region}: ${o.error}`);
  return failures.length > 0 ? `${failures.join("; ")}.` : "";
}

/** Gives the writer that recorded a transition time to react before the sweeper replays it. */
const REPLAY_GRACE_MS = 30_000;

/**
 * Folds each regional result into the monitor's state with optimistic concurrency, then reacts
 * to state transitions. The transition is written together with the state as a pending reaction
 * (an outbox), and only acknowledged once its side effects succeeded; the sweeper replays any
 * reaction left behind by a crash or a transient error.
 */
export class EvaluationService {
  constructor(private readonly deps: EvaluationDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async handle(message: ResultJobData): Promise<EvaluationOutcome | null> {
    const monitorId = toObjectId(message.monitorId);
    if (!monitorId) return null;
    const observation = {
      status: message.status,
      latencyMs: message.latencyMs,
      error: message.error,
      at: new Date(message.checkedAt),
    };

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const monitor = await this.deps.monitors.findById(monitorId);
      if (!monitor || monitor.paused || !monitor.regions.includes(message.region)) return null;
      const now = this.now();
      const outcome = evaluate(
        monitor.state,
        message.region,
        observation,
        policyFor(monitor, this.deps.flap),
        now,
      );
      if (outcome.state === monitor.state) return outcome;

      const won = await this.deps.monitors.compareAndSetState(
        monitor._id,
        monitor.state.version,
        outcome.state,
      );
      if (!won) continue;
      const pending = outcome.state.pendingReaction;
      if (outcome.transition && pending) {
        await this.react(monitor, outcome.state, pending, now);
        await this.deps.monitors.clearPendingReaction(monitor._id, pending);
      }
      return outcome;
    }
    throw new Error(
      `Gave up evaluating monitor ${message.monitorId} after ${MAX_CAS_ATTEMPTS} contended attempts`,
    );
  }

  /** Re-runs side effects of transitions whose reaction never got acknowledged. */
  async replayPendingReactions(now: Date = this.now()): Promise<number> {
    const monitors = await this.deps.monitors.findWithPendingReactions(
      new Date(now.getTime() - REPLAY_GRACE_MS),
    );
    let replayed = 0;
    for (const monitor of monitors) {
      const pending = monitor.state.pendingReaction;
      if (!pending) continue;
      try {
        await this.react(monitor, monitor.state, pending, now);
        await this.deps.monitors.clearPendingReaction(monitor._id, pending);
        replayed += 1;
      } catch (error) {
        this.deps.logger.warn({ err: error, monitor: monitor.key }, "replaying monitor transition failed");
      }
    }
    return replayed;
  }

  /**
   * Opens incidents for monitors that are down but have none, which happens when the outage began
   * inside a maintenance window that has since ended. An incident someone resolved by hand during
   * this same outage is respected rather than reopened.
   */
  async reconcileDownMonitors(now: Date = this.now()): Promise<number> {
    const monitors = await this.deps.monitors.findDownSince(new Date(now.getTime() - REPLAY_GRACE_MS));
    let opened = 0;
    for (const monitor of monitors) {
      if (monitor.state.pendingReaction) continue;
      if (await this.deps.maintenance.isUnderMaintenance(monitor.orgId, monitor.key, now)) continue;
      const since = monitor.state.since ?? now;
      if (await this.deps.incidents.hasIncidentSince(monitor._id, since)) continue;
      const votes = tallyVotes(monitor.state.regions, policyFor(monitor, this.deps.flap), now);
      await this.deps.incidents.onMonitorDown(
        monitor,
        {
          votes: `${votes.down} of ${votes.fresh} regions`,
          detail: summarizeFailures(monitor.state),
          flapping: monitor.state.flapping,
        },
        now,
      );
      opened += 1;
    }
    return opened;
  }

  private async react(
    monitor: MonitorDoc,
    state: MonitorState,
    reaction: PendingReaction,
    now: Date,
  ): Promise<void> {
    const { votes } = reaction;
    this.deps.logger.info(
      { monitor: monitor.key, from: reaction.from, to: reaction.to, votes, flapping: state.flapping },
      "monitor status changed",
    );
    await this.deps.events.publish({
      type: "monitor.status",
      orgId: monitor.orgId.toHexString(),
      monitorId: monitor._id.toHexString(),
      monitorName: monitor.name,
      public: monitor.public,
      from: reaction.from,
      to: reaction.to,
      flapping: state.flapping,
      at: reaction.at.toISOString(),
    });

    if (reaction.to === "down") {
      if (await this.deps.maintenance.isUnderMaintenance(monitor.orgId, monitor.key, now)) {
        this.deps.logger.info(
          { monitor: monitor.key },
          "monitor down during maintenance; the sweeper opens an incident if it outlasts the window",
        );
        return;
      }
      await this.deps.incidents.onMonitorDown(
        monitor,
        {
          votes: `${votes.down} of ${votes.fresh} regions`,
          detail: summarizeFailures(state),
          flapping: state.flapping,
        },
        now,
      );
      return;
    }

    if (reaction.from === "down") {
      await this.deps.incidents.onMonitorRecovered(monitor, now);
    }

    if (reaction.to === "degraded" && reaction.from === "up") {
      const reasons = Object.values(state.regions)
        .filter((o) => o.status === "degraded" && o.error)
        .map((o) => o.error);
      await this.deps.alerts.dispatch(
        {
          event: "monitor.degraded",
          orgId: monitor.orgId,
          monitors: [{ id: monitor._id, key: monitor.key, name: monitor.name }],
          incidentId: null,
          subject: `[Degraded] ${monitor.name}`,
          body: `${monitor.name} is degraded from ${votes.degraded + votes.down} of ${votes.fresh} regions. ${reasons[0] ?? ""}`.trim(),
          severity: "warning",
          url: `${this.deps.dashboardUrl}/monitors/${monitor._id.toHexString()}`,
          fields: [{ label: "Monitor", value: monitor.name }],
          dedupKey: `degraded:${monitor._id.toHexString()}`,
          dedupWindowSeconds: 30 * 60,
          suppressReason: state.flapping ? "flapping" : null,
        },
        now,
      );
    }
  }
}
