import {
  CheckResultModel,
  type EgressGuard,
  type EventPublisher,
  type Logger,
  type ProbeJobData,
  type ResultJobData,
} from "@beacon/core";
import { probeQueueName, type Region } from "@beacon/shared";
import { Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { Types } from "mongoose";
import { runCheck, type ProbeContext, type ProbeOutcome } from "./checks/index.js";
import { applyLatencyBudget } from "./checks/types.js";

export interface ProbeDeps {
  region: Region;
  simulatedRttMs: number;
  egress: EgressGuard;
  results: Pick<Queue<ResultJobData>, "add">;
  events: EventPublisher;
  logger: Logger;
  run?: (job: ProbeJobData, ctx: ProbeContext) => Promise<ProbeOutcome>;
  now?: () => Date;
}

/** Runs one probe, persists it to the time-series collection and hands it to the evaluator. */
export async function handleProbe(data: ProbeJobData, deps: ProbeDeps): Promise<ResultJobData> {
  // The latency budget is applied here, after the simulated round trip, so a region that looks
  // far away is classified on the latency it reports.
  const ctx: ProbeContext = {
    region: deps.region,
    timeoutMs: data.timeoutMs,
    degradedLatencyMs: null,
    egress: deps.egress,
  };
  const run = deps.run ?? ((job, context) => runCheck(job.check, context));
  const raw = await run(data, ctx);
  const outcome: ProbeOutcome =
    raw.status === "down"
      ? raw
      : applyLatencyBudget(
          { ...raw, latencyMs: raw.latencyMs + deps.simulatedRttMs },
          data.degradedLatencyMs,
        );
  const checkedAt = (deps.now ?? (() => new Date()))();

  await CheckResultModel.create({
    ts: checkedAt,
    meta: {
      monitorId: new Types.ObjectId(data.monitorId),
      orgId: new Types.ObjectId(data.orgId),
      region: deps.region,
    },
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    error: outcome.error,
    details: outcome.details,
  });

  const message: ResultJobData = {
    monitorId: data.monitorId,
    orgId: data.orgId,
    region: deps.region,
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    error: outcome.error,
    details: outcome.details,
    checkedAt: checkedAt.toISOString(),
  };
  await deps.results.add("result", message);
  await deps.events.publish({
    type: "check.result",
    orgId: data.orgId,
    monitorId: data.monitorId,
    region: deps.region,
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    error: outcome.error,
    checkedAt: message.checkedAt,
  });
  return message;
}

export function createProbeWorker(
  deps: ProbeDeps & { connection: ConnectionOptions; concurrency: number },
): Worker<ProbeJobData> {
  const worker = new Worker<ProbeJobData>(
    probeQueueName(deps.region),
    async (job: Job<ProbeJobData>) => {
      const result = await handleProbe(job.data, deps);
      deps.logger.debug(
        { monitorId: result.monitorId, status: result.status, latencyMs: result.latencyMs },
        "probe finished",
      );
    },
    { connection: deps.connection, concurrency: deps.concurrency },
  );
  worker.on("failed", (job, error) => {
    deps.logger.error({ err: error, monitorId: job?.data.monitorId }, "probe job failed");
  });
  return worker;
}
