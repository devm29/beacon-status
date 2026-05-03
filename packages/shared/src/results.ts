import { z } from "zod";
import { RegionSchema } from "./regions.js";

export const CHECK_STATUSES = ["up", "degraded", "down"] as const;
export const CheckStatusSchema = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const CheckDetailsSchema = z.object({
  statusCode: z.number().int().optional(),
  keywordFound: z.boolean().optional(),
  certDaysRemaining: z.number().optional(),
  certIssuer: z.string().optional(),
  certValidTo: z.string().optional(),
  resolvedAddress: z.string().optional(),
});
export type CheckDetails = z.infer<typeof CheckDetailsSchema>;

/** What a prober publishes after running a single check from one region. */
export const CheckResultMessageSchema = z.object({
  monitorId: z.string(),
  orgId: z.string(),
  region: RegionSchema,
  status: CheckStatusSchema,
  latencyMs: z.number().nonnegative(),
  error: z.string().nullable(),
  details: CheckDetailsSchema,
  checkedAt: z.iso.datetime(),
});
export type CheckResultMessage = z.infer<typeof CheckResultMessageSchema>;
