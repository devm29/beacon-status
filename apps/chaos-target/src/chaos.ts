import { z } from "zod";

export const CHAOS_MODES = ["healthy", "slow", "errors", "down", "flaky", "content"] as const;

export const ChaosStateSchema = z.object({
  mode: z.enum(CHAOS_MODES),
  /** Extra latency for `slow` mode. */
  latencyMs: z.number().int().min(0).max(30_000).default(2_500),
  /** Probability of failing a request in `errors` and `flaky` modes. */
  errorRate: z.number().min(0).max(1).default(1),
  /** Only requests from these probe regions are affected. Empty means every caller. */
  regions: z.array(z.string().min(1)).default([]),
});
export type ChaosState = z.infer<typeof ChaosStateSchema>;
export type ChaosMode = ChaosState["mode"];

export const HEALTHY: ChaosState = { mode: "healthy", latencyMs: 2_500, errorRate: 1, regions: [] };

export type ChaosVerdict =
  | { kind: "pass"; delayMs: number }
  | { kind: "error"; delayMs: number; status: number }
  | { kind: "drop" }
  | { kind: "content"; delayMs: number };

export function decide(state: ChaosState, region: string | undefined, random: () => number): ChaosVerdict {
  const jitter = 15 + Math.round(random() * 45);
  const affected = state.regions.length === 0 || (region !== undefined && state.regions.includes(region));
  if (!affected) return { kind: "pass", delayMs: jitter };

  switch (state.mode) {
    case "healthy":
      return { kind: "pass", delayMs: jitter };
    case "slow":
      return { kind: "pass", delayMs: jitter + state.latencyMs };
    case "errors":
      return random() < state.errorRate
        ? { kind: "error", delayMs: jitter, status: 503 }
        : { kind: "pass", delayMs: jitter };
    case "flaky":
      return random() < state.errorRate * 0.5
        ? { kind: "error", delayMs: jitter, status: 502 }
        : { kind: "pass", delayMs: jitter };
    case "down":
      return { kind: "drop" };
    case "content":
      return { kind: "content", delayMs: jitter };
  }
}
