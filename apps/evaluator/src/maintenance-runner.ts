import {
  SloModel,
  type AlertDispatcher,
  type IncidentService,
  type Logger,
  type MaintenanceJobData,
  type MaintenanceTask,
  type MonitorDoc,
  type MonitorRepository,
  type MonitorScheduler,
  type RollupService,
  type SloDoc,
  type SloService,
} from "@beacon/core";
import type { Queue } from "bullmq";
import type { Types } from "mongoose";
import type { EvaluationService } from "./evaluation-service.js";

export const MAINTENANCE_SCHEDULE: Record<MaintenanceTask, number> = {
  "rollup-1m": 30_000,
  "rollup-1h": 120_000,
  "rollup-1d": 600_000,
  "slo-burn": 60_000,
  "incident-sweep": 30_000,
  // Catches schedulers orphaned by monitors deleted straight from the database (a reseed, say).
  "scheduler-reconcile": 300_000,
};

export async function registerMaintenanceSchedules(queue: Queue<MaintenanceJobData>): Promise<void> {
  for (const [task, every] of Object.entries(MAINTENANCE_SCHEDULE) as [MaintenanceTask, number][]) {
    await queue.upsertJobScheduler(task, { every }, { name: task, data: { task } });
  }
}

export class MaintenanceRunner {
  constructor(
    private readonly deps: {
      rollups: RollupService;
      slos: SloService;
      incidents: IncidentService;
      monitors: MonitorRepository;
      scheduler: Pick<MonitorScheduler, "reconcile">;
      evaluation: Pick<EvaluationService, "replayPendingReactions" | "reconcileDownMonitors">;
      alerts: AlertDispatcher;
      logger: Logger;
      dashboardUrl: string;
    },
  ) {}

  async run(task: MaintenanceTask, now: Date = new Date()): Promise<void> {
    switch (task) {
      case "rollup-1m":
        return this.deps.rollups.rollupMinutes(now);
      case "rollup-1h":
        return this.deps.rollups.rollupHours(now);
      case "rollup-1d":
        return this.deps.rollups.rollupDays(now);
      case "incident-sweep":
        return this.sweep(now);
      case "slo-burn":
        return this.evaluateSlos(now);
      case "scheduler-reconcile":
        await this.deps.scheduler.reconcile(await this.deps.monitors.listAll());
        return;
    }
  }

  /**
   * Catches everything the hot path can miss: transitions whose side effects failed, outages that
   * started inside a maintenance window, pages held back while flapping, cool-downs that elapsed
   * without new results, and notifications whose queue job was lost.
   */
  private async sweep(now: Date): Promise<void> {
    const resolveMonitors = (ids: Types.ObjectId[]) => this.deps.monitors.findByIds(ids);
    const replayed = await this.deps.evaluation.replayPendingReactions(now);
    const opened = await this.deps.evaluation.reconcileDownMonitors(now);
    const paged = await this.deps.incidents.releaseDeferredPages(now, resolveMonitors);
    const resolved = await this.deps.incidents.sweep(now, resolveMonitors);
    const requeued = await this.deps.alerts.requeueStalePending(now);
    if (replayed + opened + paged + resolved + requeued > 0) {
      this.deps.logger.info({ replayed, opened, paged, resolved, requeued }, "incident sweep made changes");
    }
  }

  private async evaluateSlos(now: Date): Promise<void> {
    const slos = await SloModel.find().lean<SloDoc[]>().exec();
    if (slos.length === 0) return;
    const monitors = new Map(
      (await this.deps.monitors.findByIds(slos.map((s) => s.monitorId))).map((m): [string, MonitorDoc] => [
        m._id.toHexString(),
        m,
      ]),
    );
    for (const slo of slos) {
      const monitor = monitors.get(slo.monitorId.toHexString());
      if (!monitor) continue;
      const result = await this.deps.slos.evaluate(slo, now);
      const firing = result.burn.filter((b) => b.firing);
      const worst = firing.find((b) => b.policy.severity === "page") ?? firing[0];
      if (!worst) continue;
      const budget = Math.round(result.budgetRemaining * 1000) / 10;
      await this.deps.alerts.dispatch(
        {
          event: "slo.burn",
          orgId: slo.orgId,
          monitors: [{ id: monitor._id, key: monitor.key, name: monitor.name }],
          incidentId: null,
          subject: `[SLO ${worst.policy.severity}] ${slo.name} is burning error budget ${worst.longBurn.toFixed(1)}x too fast`,
          body: `${slo.name} (${slo.target}% over ${slo.windowDays} days) is consuming its error budget at ${worst.longBurn.toFixed(1)}x the sustainable rate over the last ${worst.policy.longWindowMs / 3_600_000}h. ${budget}% of the budget remains.`,
          severity: worst.policy.severity === "page" ? "critical" : "warning",
          url: `${this.deps.dashboardUrl}/slos/${slo._id.toHexString()}`,
          fields: [
            { label: "Policy", value: worst.policy.name },
            { label: "Long window burn", value: `${worst.longBurn.toFixed(2)}x` },
            { label: "Short window burn", value: `${worst.shortBurn.toFixed(2)}x` },
            { label: "Budget remaining", value: `${budget}%` },
          ],
          dedupKey: `slo:${slo._id.toHexString()}:${worst.policy.name}`,
          dedupWindowSeconds: 60 * 60,
        },
        now,
      );
    }
  }
}
