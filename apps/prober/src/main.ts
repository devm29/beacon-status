import {
  RedisEventPublisher,
  connectMongo,
  createLogger,
  createRedis,
  createEgressGuard,
  createResultsQueue,
  disconnectMongo,
  ensureCollections,
  loadEnv,
} from "@beacon/core";
import { ProberEnvSchema } from "./env.js";
import { createProbeWorker } from "./probe-worker.js";

const env = loadEnv(ProberEnvSchema);
const logger = createLogger("prober", env.LOG_LEVEL);

await connectMongo(env.MONGO_URL, logger);
await ensureCollections({ rawRetentionDays: env.RAW_RETENTION_DAYS });

const connection = createRedis(env.REDIS_URL, { blocking: true });
const publisherRedis = createRedis(env.REDIS_URL);
const results = createResultsQueue(connection);
const events = new RedisEventPublisher(publisherRedis);
const egress = createEgressGuard({ allowPrivate: env.ALLOW_PRIVATE_TARGETS });
if (env.ALLOW_PRIVATE_TARGETS)
  logger.warn("ALLOW_PRIVATE_TARGETS is on: monitors may probe private networks");

const workers = env.REGION.map((region) =>
  createProbeWorker({
    region,
    simulatedRttMs: env.SIMULATED_RTT_MS[region] ?? 0,
    egress,
    results,
    events,
    logger: logger.child({ region }),
    connection,
    concurrency: env.PROBE_CONCURRENCY,
  }),
);
logger.info({ regions: env.REGION, concurrency: env.PROBE_CONCURRENCY }, "prober started");

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down prober");
  await Promise.all(workers.map((w) => w.close()));
  await results.close();
  publisherRedis.disconnect();
  connection.disconnect();
  await disconnectMongo();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
