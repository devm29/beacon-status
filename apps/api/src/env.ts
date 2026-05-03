import { BaseEnvSchema, requireProductionSecrets } from "@beacon/core";
import { z } from "zod";

const DEV_REALTIME_SECRET = "dev-realtime-secret-change-me";
const DEV_REVALIDATE_SECRET = "dev-revalidate-secret";

export const ApiEnvSchema = BaseEnvSchema.extend({
  API_PORT: z.coerce.number().int().default(8111),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3111,http://127.0.0.1:3111")
    .transform((v) =>
      v
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  REALTIME_SECRET: z.string().min(16).default(DEV_REALTIME_SECRET),
  PUBLIC_WEB_URL: z.url().default("http://localhost:3111"),
  WEB_REVALIDATE_URL: z.url().optional(),
  REVALIDATE_SECRET: z.string().min(8).default(DEV_REVALIDATE_SECRET),
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  AUTH_FAILURES_PER_15_MINUTES: z.coerce.number().int().min(1).default(50),
  SSE_MAX_PER_IP: z.coerce.number().int().min(1).default(20),
  SSE_MAX_PER_ORG: z.coerce.number().int().min(1).default(5_000),
  STATUS_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(10),
}).superRefine((env, ctx) =>
  requireProductionSecrets(
    env.NODE_ENV,
    {
      REALTIME_SECRET: { value: env.REALTIME_SECRET, devDefault: DEV_REALTIME_SECRET },
      REVALIDATE_SECRET: { value: env.REVALIDATE_SECRET, devDefault: DEV_REVALIDATE_SECRET },
    },
    ctx,
  ),
);
export type ApiEnv = z.infer<typeof ApiEnvSchema>;
