/**
 * Upper bounds (inclusive, ms) of the latency histogram stored in every rollup. Fixed buckets make
 * rollups mergeable: an hourly histogram is the element-wise sum of its minute histograms, so
 * percentiles stay meaningful at every granularity without keeping raw samples around.
 */
export const LATENCY_BOUNDS_MS = [25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2500, 5000, 10_000] as const;

export const HISTOGRAM_SIZE = LATENCY_BOUNDS_MS.length + 1;

export function emptyHistogram(): number[] {
  return Array.from({ length: HISTOGRAM_SIZE }, () => 0);
}

export function bucketIndex(latencyMs: number): number {
  const index = LATENCY_BOUNDS_MS.findIndex((bound) => latencyMs <= bound);
  return index === -1 ? LATENCY_BOUNDS_MS.length : index;
}

export function mergeHistograms(histograms: readonly (readonly number[])[]): number[] {
  const merged = emptyHistogram();
  for (const histogram of histograms) {
    for (let i = 0; i < HISTOGRAM_SIZE; i++) merged[i] = (merged[i] ?? 0) + (histogram[i] ?? 0);
  }
  return merged;
}

/** Estimates a percentile by linear interpolation inside the bucket that contains the rank. */
export function percentileFromHistogram(
  histogram: readonly number[],
  quantile: number,
  maxMs: number,
): number | null {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const rank = Math.min(Math.max(quantile, 0), 1) * total;
  let seen = 0;
  for (let i = 0; i < HISTOGRAM_SIZE; i++) {
    const count = histogram[i] ?? 0;
    if (count === 0) continue;
    if (seen + count >= rank) {
      const lower = i === 0 ? 0 : (LATENCY_BOUNDS_MS[i - 1] ?? 0);
      const upper = LATENCY_BOUNDS_MS[i] ?? Math.max(maxMs, lower);
      const fraction = (rank - seen) / count;
      return Math.round(Math.min(lower + (upper - lower) * fraction, Math.max(maxMs, lower)));
    }
    seen += count;
  }
  return Math.round(maxMs);
}
