import { REGIONS, probeQueueName, type Check, type CheckResultMessage, type Region } from "@beacon/shared";
import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

export const RESULTS_QUEUE = "check-results";
export const NOTIFY_QUEUE = "notifications";
export const MAINTENANCE_QUEUE = "maintenance";

export interface ProbeJobData {
  monitorId: string;
  orgId: string;
  check: Check;
  timeoutMs: number;
  degradedLatencyMs: number | null;
}

export type ResultJobData = CheckResultMessage;

export interface NotifyJobData {
  notificationId: string;
}

export type MaintenanceTask =
  "rollup-1m" | "rollup-1h" | "rollup-1d" | "slo-burn" | "incident-sweep" | "scheduler-reconcile";

export interface MaintenanceJobData {
  task: MaintenanceTask;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { count: 200, age: 3600 },
  removeOnFail: { count: 1000, age: 86_400 },
};

export interface ProbeQueues {
  get(region: Region): Queue<ProbeJobData>;
  all(): Queue<ProbeJobData>[];
  close(): Promise<void>;
}

export function createProbeQueues(connection: ConnectionOptions): ProbeQueues {
  const queues = new Map<Region, Queue<ProbeJobData>>(
    REGIONS.map((region) => [
      region,
      new Queue<ProbeJobData>(probeQueueName(region), { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    ]),
  );
  return {
    get(region) {
      const queue = queues.get(region);
      if (!queue) throw new Error(`Unknown region ${region}`);
      return queue;
    },
    all: () => [...queues.values()],
    close: async () => {
      await Promise.all([...queues.values()].map((q) => q.close()));
    },
  };
}

export function createResultsQueue(connection: ConnectionOptions): Queue<ResultJobData> {
  return new Queue<ResultJobData>(RESULTS_QUEUE, {
    connection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 5, backoff: { type: "exponential", delay: 500 } },
  });
}

export function createNotifyQueue(connection: ConnectionOptions): Queue<NotifyJobData> {
  return new Queue<NotifyJobData>(NOTIFY_QUEUE, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 6,
      backoff: { type: "exponential", delay: 2_000 },
    },
  });
}

export function createMaintenanceQueue(connection: ConnectionOptions): Queue<MaintenanceJobData> {
  return new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}
