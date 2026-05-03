import { z } from "zod";

export const REGIONS = ["us-east", "eu-west", "ap-southeast"] as const;

export const RegionSchema = z.enum(REGIONS);
export type Region = z.infer<typeof RegionSchema>;

export const REGION_LABELS: Record<Region, string> = {
  "us-east": "US East (Virginia)",
  "eu-west": "EU West (Dublin)",
  "ap-southeast": "Asia Pacific (Singapore)",
};

export function probeQueueName(region: Region): string {
  return `probe-${region}`;
}
