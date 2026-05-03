import { BaseEnvSchema } from "@beacon/core";
import { REGIONS, RegionSchema, type Region } from "@beacon/shared";
import { z } from "zod";

const regionList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
  )
  .pipe(z.array(RegionSchema).min(1));

export const ProberEnvSchema = BaseEnvSchema.extend({
  /** One region per container in production; a comma list lets a single dev process play all three. */
  REGION: regionList.default([...REGIONS]),
  PROBE_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(25),
  /** Added to measured latency to make simulated regions look geographically distinct. */
  SIMULATED_RTT_MS: z
    .string()
    .default("us-east:0,eu-west:38,ap-southeast:92")
    .transform((value) => {
      const map: Partial<Record<Region, number>> = {};
      for (const pair of value.split(",")) {
        const [region, ms] = pair.split(":");
        const parsed = RegionSchema.safeParse(region?.trim());
        if (parsed.success && ms !== undefined && Number.isFinite(Number(ms))) map[parsed.data] = Number(ms);
      }
      return map;
    }),
});
export type ProberEnv = z.infer<typeof ProberEnvSchema>;
