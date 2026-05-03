import { createServer } from "node:http";
import {
  MonitorScheduler,
  RedisEventPublisher,
  connectMongo,
  createLogger,
  createNotifyQueue,
  createProbeQueues,
  createRedis,
  disconnectMongo,
  ensureCollections,
  loadEnv,
  queueDeliveryScheduler,
  redisDedupStore,
  subscribeToEvents,
} from "@beacon/core";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { composeContainer } from "./compose.js";
import { redisStoreFactory } from "./http/rate-limit.js";
import { ApiEnvSchema } from "./env.js";
import { createFanout } from "./realtime/fanout.js";
import { StatusPageRevalidator } from "./realtime/revalidator.js";
import { createSocketServer } from "./realtime/socket.js";

const env = loadEnv(ApiEnvSchema);
const logger = createLogger("api", env.LOG_LEVEL);

await connectMongo(env.MONGO_URL, logger);
await ensureCollections({ rawRetentionDays: env.RAW_RETENTION_DAYS });

const redis = createRedis(env.REDIS_URL);
const subscriber = createRedis(env.REDIS_URL);
const queueConnection = createRedis(env.REDIS_URL, { blocking: true });
const probeQueues = createProbeQueues(queueConnection);
const notifyQueue = createNotifyQueue(queueConnection);

const container = composeContainer({
  logger,
  events: new RedisEventPublisher(redis),
  scheduler: new MonitorScheduler(probeQueues, logger),
  delivery: queueDeliveryScheduler(notifyQueue),
  dedup: redisDedupStore(redis),
  corsOrigins: env.CORS_ORIGINS,
  realtimeSecret: env.REALTIME_SECRET,
  dashboardUrl: env.PUBLIC_WEB_URL,
  limits: {
    publicPerMinute: env.PUBLIC_RATE_LIMIT_PER_MINUTE,
    authFailuresPer15Minutes: env.AUTH_FAILURES_PER_15_MINUTES,
    maxPerIp: env.SSE_MAX_PER_IP,
    maxPerOrg: env.SSE_MAX_PER_ORG,
  },
  rateLimitStores: redisStoreFactory(redis),
  statusCacheTtlMs: env.STATUS_CACHE_TTL_SECONDS * 1000,
  readiness: async () => {
    const mongo = await mongoose.connection.db
      ?.admin()
      .ping()
      .then(
        () => true,
        () => false,
      );
    const cache = await redis.ping().then(
      (r) => r === "PONG",
      () => false,
    );
    return { mongo: mongo ?? false, redis: cache };
  },
});

const app = createApp(container);
const http = createServer(app);
const io = createSocketServer(http, { origins: env.CORS_ORIGINS, secret: env.REALTIME_SECRET, logger });
const revalidator = new StatusPageRevalidator({
  url: env.WEB_REVALIDATE_URL,
  secret: env.REVALIDATE_SECRET,
  debounceMs: 1_500,
  logger,
});
const unsubscribe = await subscribeToEvents(
  subscriber,
  logger,
  createFanout({
    io,
    sse: container.sse,
    revalidator,
    orgs: container.orgs,
    statusPage: container.statusPage,
    logger,
  }),
);

http.listen(env.API_PORT, () => logger.info({ port: env.API_PORT }, "api listening"));

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down api");
  container.sse.close();
  revalidator.close();
  await unsubscribe();
  await io.close();
  await Promise.all([probeQueues.close(), notifyQueue.close()]);
  redis.disconnect();
  subscriber.disconnect();
  queueConnection.disconnect();
  await disconnectMongo();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
