import { BaseEnvSchema } from "@beacon/core";
import { z } from "zod";

export const EvaluatorEnvSchema = BaseEnvSchema.extend({
  PUBLIC_WEB_URL: z.url().default("http://localhost:3111"),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("Beacon <alerts@beacon.local>"),
  RESULTS_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  RESOLVE_AFTER_SECONDS: z.coerce.number().int().min(0).default(180),
  REOPEN_WINDOW_SECONDS: z.coerce.number().int().min(0).default(900),
  FLAP_WINDOW_MINUTES: z.coerce.number().int().min(1).default(20),
  FLAP_THRESHOLD: z.coerce.number().int().min(2).default(4),
  FLAPPING_PAGE_DELAY_MINUTES: z.coerce.number().int().min(1).default(10),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).default(10_000),
});
export type EvaluatorEnv = z.infer<typeof EvaluatorEnvSchema>;
