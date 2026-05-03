import {
  AlertDispatcher,
  IncidentService,
  MAINTENANCE_QUEUE,
  MaintenanceRepository,
  MonitorRepository,
  MonitorScheduler,
  NOTIFY_QUEUE,
  RESULTS_QUEUE,
  RedisEventPublisher,
  RollupService,
  SloService,
  connectMongo,
  createLogger,
  createMaintenanceQueue,
  createNotifyQueue,
  createProbeQueues,
  createEgressGuard,
  createRedis,
  disconnectMongo,
  ensureCollections,
  loadEnv,
  queueDeliveryScheduler,
  redisDedupStore,
  type MaintenanceJobData,
  type NotifyJobData,
  type ResultJobData,
} from "@beacon/core";
import { CheckResultMessageSchema } from "@beacon/shared";
import { UnrecoverableError, Worker } from "bullmq";
import { DeliveryService } from "./delivery-service.js";
import { EvaluatorEnvSchema } from "./env.js";
import { EvaluationService } from "./evaluation-service.js";
import { MaintenanceRunner, registerMaintenanceSchedules } from "./maintenance-runner.js";
import { DiscordProvider } from "./providers/discord.js";
import { EmailProvider } from "./providers/email.js";
import { ProviderRegistry } from "./providers/registry.js";
import { SlackProvider } from "./providers/slack.js";
import { WebhookProvider } from "./providers/webhook.js";

const env = loadEnv(EvaluatorEnvSchema);
const logger = createLogger("evaluator", env.LOG_LEVEL);

await connectMongo(env.MONGO_URL, logger);
await ensureCollections({ rawRetentionDays: env.RAW_RETENTION_DAYS });

const connection = createRedis(env.REDIS_URL, { blocking: true });
const redis = createRedis(env.REDIS_URL);
const notifyQueue = createNotifyQueue(connection);
const maintenanceQueue = createMaintenanceQueue(connection);
const probeQueues = createProbeQueues(connection);

const events = new RedisEventPublisher(redis);
const monitors = new MonitorRepository();
const maintenance = new MaintenanceRepository();
const alerts = new AlertDispatcher({
  dedup: redisDedupStore(redis),
  delivery: queueDeliveryScheduler(notifyQueue),
  maintenance,
  logger: logger.child({ component: "alerts" }),
});
const incidents = new IncidentService({
  events,
  alerts,
  logger: logger.child({ component: "incidents" }),
  dashboardUrl: env.PUBLIC_WEB_URL,
  flappingPageDelayMs: env.FLAPPING_PAGE_DELAY_MINUTES * 60_000,
  policy: {
    resolveAfterMs: env.RESOLVE_AFTER_SECONDS * 1000,
    reopenWindowMs: env.REOPEN_WINDOW_SECONDS * 1000,
  },
});
const evaluation = new EvaluationService({
  monitors,
  incidents,
  alerts,
  maintenance,
  events,
  logger: logger.child({ component: "evaluation" }),
  flap: { flapWindowMs: env.FLAP_WINDOW_MINUTES * 60_000, flapThreshold: env.FLAP_THRESHOLD },
  dashboardUrl: env.PUBLIC_WEB_URL,
});
const http = {
  timeoutMs: env.WEBHOOK_TIMEOUT_MS,
  egress: createEgressGuard({ allowPrivate: env.ALLOW_PRIVATE_TARGETS }),
};
const delivery = new DeliveryService(
  new ProviderRegistry({
    email: new EmailProvider(
      { smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM },
      logger.child({ component: "email" }),
    ),
    slack: new SlackProvider(http),
    discord: new DiscordProvider(http),
    webhook: new WebhookProvider(http),
  }),
  logger.child({ component: "delivery" }),
);
const scheduler = new MonitorScheduler(probeQueues, logger.child({ component: "scheduler" }));
const runner = new MaintenanceRunner({
  rollups: new RollupService(),
  slos: new SloService(),
  incidents,
  monitors,
  scheduler,
  evaluation,
  alerts,
  logger: logger.child({ component: "maintenance" }),
  dashboardUrl: env.PUBLIC_WEB_URL,
});

await scheduler.reconcile(await monitors.listAll());
await registerMaintenanceSchedules(maintenanceQueue);

const resultsWorker = new Worker<ResultJobData>(
  RESULTS_QUEUE,
  async (job) => {
    const parsed = CheckResultMessageSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`Malformed check result: ${parsed.error.message}`);
    await evaluation.handle(parsed.data);
  },
  { connection, concurrency: env.RESULTS_CONCURRENCY },
);

const notifyWorker = new Worker<NotifyJobData>(
  NOTIFY_QUEUE,
  async (job) => {
    const attempts = job.opts.attempts ?? 1;
    await delivery.deliver(job.data.notificationId, { finalAttempt: job.attemptsMade + 1 >= attempts });
  },
  { connection, concurrency: 5 },
);

const maintenanceWorker = new Worker<MaintenanceJobData>(
  MAINTENANCE_QUEUE,
  async (job) => {
    const started = Date.now();
    await runner.run(job.data.task);
    logger.debug({ task: job.data.task, ms: Date.now() - started }, "maintenance task finished");
  },
  { connection, concurrency: 1 },
);

for (const [name, worker] of [
  ["results", resultsWorker],
  ["notifications", notifyWorker],
  ["maintenance", maintenanceWorker],
] as const) {
  worker.on("failed", (job, error) =>
    logger.error({ err: error, queue: name, jobId: job?.id }, "job failed"),
  );
}
logger.info("evaluator started");

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down evaluator");
  await Promise.all([resultsWorker.close(), notifyWorker.close(), maintenanceWorker.close()]);
  await Promise.all([notifyQueue.close(), maintenanceQueue.close(), probeQueues.close()]);
  redis.disconnect();
  connection.disconnect();
  await disconnectMongo();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
