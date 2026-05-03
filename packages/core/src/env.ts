import { z } from "zod";

export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MONGO_URL: z.string().min(1).default("mongodb://127.0.0.1:27111/beacon"),
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6411"),
  RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  ALLOW_PRIVATE_TARGETS: z.stringbool().default(false),
});
export type BaseEnv = z.infer<typeof BaseEnvSchema>;

/**
 * Secrets that ship with development defaults. Production refuses them, because anyone who has read
 * the repository could otherwise mint realtime tokens or flush the status page cache.
 */
export function requireProductionSecrets(
  nodeEnv: string,
  secrets: Record<string, { value: string | undefined; devDefault: string }>,
  ctx: z.RefinementCtx,
): void {
  if (nodeEnv !== "production") return;
  for (const [name, { value, devDefault }] of Object.entries(secrets)) {
    if (!value || value === devDefault || /change-?me/i.test(value)) {
      ctx.addIssue({
        code: "custom",
        path: [name],
        message: `${name} must be set to a unique secret in production`,
      });
    }
  }
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Parses process.env against a schema and fails fast with every problem listed at once. */
export function loadEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
