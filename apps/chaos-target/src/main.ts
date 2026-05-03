import { pino } from "pino";
import { z } from "zod";
import { createChaosApp } from "./app.js";

const env = z
  .object({
    NODE_ENV: z.string().default("development"),
    CHAOS_PORT: z.coerce.number().int().default(5511),
    CHAOS_ADMIN_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(8).optional()),
    LOG_LEVEL: z.string().default("info"),
  })
  .refine((e) => e.NODE_ENV !== "production" || e.CHAOS_ADMIN_TOKEN !== undefined, {
    path: ["CHAOS_ADMIN_TOKEN"],
    message: "CHAOS_ADMIN_TOKEN is required in production; anyone could take the target down otherwise",
  })
  .parse(process.env);

const logger = pino({ name: "chaos-target", level: env.LOG_LEVEL });
const { app } = createChaosApp({ logger, adminToken: env.CHAOS_ADMIN_TOKEN });

const server = app.listen(env.CHAOS_PORT, () => {
  logger.info({ port: env.CHAOS_PORT }, "chaos target listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  });
}
