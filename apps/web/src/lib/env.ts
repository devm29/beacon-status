import "server-only";
import { z } from "zod";

export const DEV_REVALIDATE_SECRET = "dev-revalidate-secret";
export const isProduction = process.env.NODE_ENV === "production";

const ServerEnvSchema = z.object({
  API_INTERNAL_URL: z.url().default("http://127.0.0.1:8111"),
  /** Where browsers reach the API for Socket.IO and SSE; read at runtime so one image fits every deploy. */
  BROWSER_API_URL: z.url().default("http://localhost:8111"),
  /** Where the public status pages live, for links people paste elsewhere. */
  PUBLIC_WEB_URL: z.url().default("http://localhost:3111"),
  /** Development convenience: signs the console in with this key when no cookie is present. */
  BEACON_API_KEY: z.string().min(1).optional(),
  REVALIDATE_SECRET: z.string().min(8).default(DEV_REVALIDATE_SECRET),
  STATUS_REVALIDATE_SECONDS: z.coerce.number().int().min(5).default(60),
});

export const serverEnv = ServerEnvSchema.parse({
  API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  BROWSER_API_URL: process.env.BROWSER_API_URL,
  PUBLIC_WEB_URL: process.env.PUBLIC_WEB_URL,
  BEACON_API_KEY: (!isProduction && process.env.BEACON_API_KEY) || undefined,
  REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
  STATUS_REVALIDATE_SECONDS: process.env.STATUS_REVALIDATE_SECONDS,
});
