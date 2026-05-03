import { HISTOGRAM_SIZE, bucketIndex, type CheckStatus } from "@beacon/shared";

/** Deterministic PRNG so every seeded install renders the same charts. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface LatencyProfile {
  baseMs: number;
  /** Relative swing between the quietest and busiest hour of the day. */
  diurnal: number;
  /** Log-normal sigma of per-probe noise. */
  jitter: number;
}

export interface Disruption {
  start: Date;
  end: Date;
  kind: "down" | "slow";
  /** Share of probes affected while the disruption is active. */
  severity: number;
  extraLatencyMs?: number;
}

export function sampleLatency(profile: LatencyProfile, at: Date, random: () => number): number {
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60;
  const load = 1 + profile.diurnal * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  const u1 = Math.max(random(), 1e-9);
  const u2 = random();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(3, profile.baseMs * load * Math.exp(profile.jitter * gaussian));
}

export interface SyntheticProbe {
  status: CheckStatus;
  latencyMs: number;
}

export function synthesizeProbe(
  profile: LatencyProfile,
  at: Date,
  disruptions: readonly Disruption[],
  degradedLatencyMs: number | null,
  random: () => number,
  baselineFailureRate = 0.0004,
): SyntheticProbe {
  const active = disruptions.find((d) => at >= d.start && at < d.end);
  let latencyMs = sampleLatency(profile, at, random);
  if (active?.kind === "slow" && random() < active.severity) latencyMs += active.extraLatencyMs ?? 1500;
  if ((active?.kind === "down" && random() < active.severity) || random() < baselineFailureRate) {
    return { status: "down", latencyMs: 10_000 };
  }
  const status: CheckStatus = degradedLatencyMs !== null && latencyMs > degradedLatencyMs ? "degraded" : "up";
  return { status, latencyMs: Math.round(latencyMs) };
}

export interface HourAccumulator {
  total: number;
  up: number;
  degraded: number;
  down: number;
  latencySum: number;
  latencyCount: number;
  latencyMin: number | null;
  latencyMax: number | null;
  hist: number[];
}

export function emptyAccumulator(): HourAccumulator {
  return {
    total: 0,
    up: 0,
    degraded: 0,
    down: 0,
    latencySum: 0,
    latencyCount: 0,
    latencyMin: null,
    latencyMax: null,
    hist: Array.from({ length: HISTOGRAM_SIZE }, () => 0),
  };
}

export function accumulate(acc: HourAccumulator, probe: SyntheticProbe): void {
  acc.total += 1;
  acc[probe.status] += 1;
  if (probe.status === "down") return;
  acc.latencySum += probe.latencyMs;
  acc.latencyCount += 1;
  acc.latencyMin = acc.latencyMin === null ? probe.latencyMs : Math.min(acc.latencyMin, probe.latencyMs);
  acc.latencyMax = acc.latencyMax === null ? probe.latencyMs : Math.max(acc.latencyMax, probe.latencyMs);
  const index = bucketIndex(probe.latencyMs);
  acc.hist[index] = (acc.hist[index] ?? 0) + 1;
}
