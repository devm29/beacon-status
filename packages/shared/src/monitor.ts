import { z } from "zod";
import { REGIONS, RegionSchema } from "./regions.js";

export const KeySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single dashes, like public-api");

const StatusMatcherSchema = z.union([
  z.number().int().min(100).max(599),
  z.string().regex(/^[1-5]xx$/, "Use a status code like 200 or a class like 2xx"),
]);
export type StatusMatcher = z.infer<typeof StatusMatcherSchema>;

const HttpMethodSchema = z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const httpFields = {
  url: z.url({ protocol: /^https?$/ }),
  method: HttpMethodSchema.default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(64_000).optional(),
  expectedStatus: z.array(StatusMatcherSchema).min(1).default(["2xx"]),
  followRedirects: z.boolean().default(true),
};

export const HttpCheckSchema = z.object({ type: z.literal("http"), ...httpFields });

export const KeywordCheckSchema = z.object({
  type: z.literal("keyword"),
  ...httpFields,
  keyword: z.string().min(1).max(500),
  mode: z.enum(["contains", "absent"]).default("contains"),
  caseSensitive: z.boolean().default(false),
});

const HostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.-]+$|^\[[0-9a-fA-F:]+\]$/, "Enter a hostname or IP address");

export const TcpCheckSchema = z.object({
  type: z.literal("tcp"),
  host: HostSchema,
  port: z.number().int().min(1).max(65_535),
});

export const SslCheckSchema = z
  .object({
    type: z.literal("ssl"),
    host: HostSchema,
    port: z.number().int().min(1).max(65_535).default(443),
    warnDays: z.number().int().min(1).max(365).default(21),
    criticalDays: z.number().int().min(0).max(365).default(7),
  })
  .refine((c) => c.criticalDays < c.warnDays, {
    path: ["criticalDays"],
    message: "Critical threshold must be lower than the warning threshold",
  });

export const CheckSchema = z.discriminatedUnion("type", [
  HttpCheckSchema,
  KeywordCheckSchema,
  TcpCheckSchema,
  SslCheckSchema,
]);
export type Check = z.infer<typeof CheckSchema>;
export type CheckInput = z.input<typeof CheckSchema>;
export type CheckType = Check["type"];
export type HttpCheck = z.infer<typeof HttpCheckSchema>;
export type KeywordCheck = z.infer<typeof KeywordCheckSchema>;
export type TcpCheck = z.infer<typeof TcpCheckSchema>;
export type SslCheck = z.infer<typeof SslCheckSchema>;

export const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  http: "HTTP",
  keyword: "Keyword",
  tcp: "TCP",
  ssl: "SSL certificate",
};

export const MonitorSpecSchema = z
  .object({
    key: KeySchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(280).default(""),
    group: z.string().trim().min(1).max(60).default("Services"),
    check: CheckSchema,
    intervalSeconds: z.number().int().min(10).max(3600).default(60),
    timeoutMs: z.number().int().min(500).max(30_000).default(10_000),
    regions: z
      .array(RegionSchema)
      .min(1)
      .default([...REGIONS])
      .refine((r) => new Set(r).size === r.length, "Regions must be unique"),
    quorum: z.number().int().min(1).max(REGIONS.length).default(2),
    failThreshold: z.number().int().min(1).max(10).default(2),
    recoverThreshold: z.number().int().min(1).max(20).default(3),
    degradedLatencyMs: z.number().int().positive().max(60_000).nullable().default(null),
    public: z.boolean().default(true),
    paused: z.boolean().default(false),
  })
  .refine((m) => m.quorum <= m.regions.length, {
    path: ["quorum"],
    message: "Quorum cannot be larger than the number of regions",
  })
  .refine((m) => m.timeoutMs < m.intervalSeconds * 1000, {
    path: ["timeoutMs"],
    message: "Timeout must be shorter than the check interval",
  });

export type MonitorSpec = z.infer<typeof MonitorSpecSchema>;
export type MonitorSpecInput = z.input<typeof MonitorSpecSchema>;

export function describeTarget(check: Check): string {
  switch (check.type) {
    case "http":
    case "keyword":
      return check.url;
    case "tcp":
      return `${check.host}:${check.port}`;
    case "ssl":
      return check.port === 443 ? check.host : `${check.host}:${check.port}`;
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
