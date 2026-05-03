import { z } from "zod";
import { REGIONS, RegionSchema, type Region } from "./regions.js";
import { CheckStatusSchema, type CheckStatus } from "./results.js";

export const MONITOR_STATUSES = ["pending", "up", "degraded", "down"] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

export interface RegionObservation {
  status: CheckStatus;
  latencyMs: number;
  error: string | null;
  at: Date;
}

export interface Votes {
  up: number;
  degraded: number;
  down: number;
  fresh: number;
}

export interface Transition {
  from: MonitorStatus;
  to: MonitorStatus;
  at: Date;
}

/** A transition whose side effects (incident, alerts, events) have not been acknowledged yet. */
export interface PendingReaction extends Transition {
  votes: Votes;
}

export interface MonitorState {
  status: MonitorStatus;
  since: Date | null;
  regions: Partial<Record<Region, RegionObservation>>;
  /** Regions that have reported in the probe round that is still open. */
  roundRegions: Region[];
  /** Consecutive completed rounds whose quorum verdict was `streakVerdict`. */
  streakVerdict: CheckStatus | null;
  streakCount: number;
  /** Consecutive completed rounds that were not a quorum failure; drives recovery hysteresis. */
  okStreak: number;
  transitions: Date[];
  flapping: boolean;
  lastCheckedAt: Date | null;
  pendingReaction: PendingReaction | null;
  version: number;
}

export interface EvaluationPolicy {
  regions: readonly Region[];
  quorum: number;
  failThreshold: number;
  recoverThreshold: number;
  intervalSeconds: number;
  flapWindowMs: number;
  flapThreshold: number;
}

export interface EvaluationOutcome {
  state: MonitorState;
  verdict: CheckStatus | "insufficient";
  votes: Votes;
  roundClosed: boolean;
  transition: Transition | null;
}

export const DEFAULT_FLAP_WINDOW_MS = 20 * 60_000;
export const DEFAULT_FLAP_THRESHOLD = 4;

export function initialMonitorState(): MonitorState {
  return {
    status: "pending",
    since: null,
    regions: {},
    roundRegions: [],
    streakVerdict: null,
    streakCount: 0,
    okStreak: 0,
    transitions: [],
    flapping: false,
    lastCheckedAt: null,
    pendingReaction: null,
    version: 0,
  };
}

const ObservationSchema = z.object({
  status: CheckStatusSchema,
  latencyMs: z.number(),
  error: z.string().nullable(),
  at: z.coerce.date(),
});

const VotesSchema = z.object({
  up: z.number(),
  degraded: z.number(),
  down: z.number(),
  fresh: z.number(),
});

const MonitorStatusSchema = z.enum(MONITOR_STATUSES);

const StoredStateSchema = z.object({
  status: MonitorStatusSchema.catch("pending"),
  since: z.coerce.date().nullable().catch(null),
  regions: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((raw) => {
      const regions: Partial<Record<Region, RegionObservation>> = {};
      for (const region of REGIONS) {
        const parsed = ObservationSchema.safeParse(raw[region]);
        if (parsed.success) regions[region] = parsed.data;
      }
      return regions;
    }),
  roundRegions: z.array(RegionSchema).catch([]),
  streakVerdict: CheckStatusSchema.nullable().catch(null),
  streakCount: z.number().int().nonnegative().catch(0),
  okStreak: z.number().int().nonnegative().catch(0),
  transitions: z.array(z.coerce.date()).catch([]),
  flapping: z.boolean().catch(false),
  lastCheckedAt: z.coerce.date().nullable().catch(null),
  pendingReaction: z
    .object({ from: MonitorStatusSchema, to: MonitorStatusSchema, at: z.coerce.date(), votes: VotesSchema })
    .nullable()
    .catch(null),
  version: z.number().int().nonnegative().catch(0),
});

/**
 * State is stored as a schemaless subdocument, so documents written by older versions can miss
 * fields. Reads go through this instead of trusting the stored shape.
 */
export function parseMonitorState(raw: unknown): MonitorState {
  const parsed = StoredStateSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : initialMonitorState();
}

/**
 * A region's observation counts toward the vote while it is younger than a few check intervals.
 * Without this, a region whose worker died would keep voting with whatever it last saw.
 */
export function staleAfterMs(intervalSeconds: number): number {
  return Math.max(intervalSeconds * 3, 90) * 1000;
}

function isFresh(observation: RegionObservation | undefined, cutoff: number): boolean {
  return observation !== undefined && observation.at.getTime() >= cutoff;
}

export function tallyVotes(
  regions: Partial<Record<Region, RegionObservation>>,
  policy: Pick<EvaluationPolicy, "regions" | "intervalSeconds">,
  now: Date,
): Votes {
  const cutoff = now.getTime() - staleAfterMs(policy.intervalSeconds);
  const votes: Votes = { up: 0, degraded: 0, down: 0, fresh: 0 };
  for (const region of policy.regions) {
    const observation = regions[region];
    if (!observation || !isFresh(observation, cutoff)) continue;
    votes.fresh += 1;
    votes[observation.status] += 1;
  }
  return votes;
}

export function quorumVerdict(
  votes: Votes,
  quorum: number,
  regionCount: number,
): CheckStatus | "insufficient" {
  if (votes.fresh < Math.min(quorum, regionCount)) return "insufficient";
  if (votes.down >= quorum) return "down";
  if (votes.down + votes.degraded >= quorum) return "degraded";
  return "up";
}

/**
 * Regions report independently, so a "round" is closed once every region we still expect to hear
 * from has reported, or as soon as any region reports twice (its next round has started). A
 * region that has gone stale is not waited for.
 */
function closesRound(
  roundRegions: readonly Region[],
  regions: Partial<Record<Region, RegionObservation>>,
  policy: Pick<EvaluationPolicy, "regions" | "intervalSeconds">,
  now: Date,
): boolean {
  const cutoff = now.getTime() - staleAfterMs(policy.intervalSeconds);
  return policy.regions.every((region) => {
    const observation = regions[region];
    return roundRegions.includes(region) || (observation !== undefined && !isFresh(observation, cutoff));
  });
}

function shouldTransition(state: MonitorState, verdict: CheckStatus, policy: EvaluationPolicy): boolean {
  if (state.status === verdict) return false;
  if (state.status === "pending") return verdict !== "down" || state.streakCount >= policy.failThreshold;
  if (verdict === "down") return state.streakCount >= policy.failThreshold;
  if (state.status === "down") {
    const required = state.flapping ? policy.recoverThreshold * 2 : policy.recoverThreshold;
    return state.okStreak >= required;
  }
  return state.streakCount >= policy.failThreshold;
}

/**
 * Folds one regional result into the monitor state. Hysteresis counts probe rounds rather than
 * individual results: a monitor is declared down only after the quorum verdict of
 * `failThreshold` consecutive rounds was down, and recovers after `recoverThreshold` consecutive
 * healthy rounds (doubled while flapping).
 */
export function evaluate(
  previous: MonitorState,
  region: Region,
  observation: RegionObservation,
  policy: EvaluationPolicy,
  now: Date,
): EvaluationOutcome {
  const existing = previous.regions[region];
  if (existing && existing.at.getTime() >= observation.at.getTime()) {
    const votes = tallyVotes(previous.regions, policy, now);
    return { state: previous, verdict: "insufficient", votes, roundClosed: false, transition: null };
  }

  const regions = { ...previous.regions, [region]: observation };
  const votes = tallyVotes(regions, policy, now);
  const verdict = quorumVerdict(votes, policy.quorum, policy.regions.length);
  const flapCutoff = now.getTime() - policy.flapWindowMs;
  const recentTransitions = previous.transitions.filter((t) => t.getTime() >= flapCutoff);

  const reportedTwice = previous.roundRegions.includes(region);
  const roundRegions = reportedTwice ? [region] : [...previous.roundRegions, region];
  const roundClosed = reportedTwice || closesRound(roundRegions, regions, policy, now);

  let state: MonitorState = {
    ...previous,
    regions,
    roundRegions: roundClosed && !reportedTwice ? [] : roundRegions,
    transitions: recentTransitions,
    flapping: recentTransitions.length >= policy.flapThreshold,
    lastCheckedAt: observation.at,
  };

  if (!roundClosed || verdict === "insufficient") {
    return { state, verdict, votes, roundClosed, transition: null };
  }

  state = {
    ...state,
    streakVerdict: verdict,
    streakCount: state.streakVerdict === verdict ? state.streakCount + 1 : 1,
    okStreak: verdict === "down" ? 0 : state.okStreak + 1,
  };

  if (!shouldTransition(state, verdict, policy)) {
    return { state, verdict, votes, roundClosed, transition: null };
  }

  const transition: Transition = { from: state.status, to: verdict, at: now };
  const transitions =
    transition.from === "pending" ? recentTransitions : [...recentTransitions, now].slice(-20);
  state = {
    ...state,
    status: verdict,
    since: now,
    transitions,
    flapping: transitions.length >= policy.flapThreshold,
    pendingReaction: { ...transition, votes },
  };
  return { state, verdict, votes, roundClosed, transition };
}
