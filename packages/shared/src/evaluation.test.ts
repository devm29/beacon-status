import { describe, expect, it } from "vitest";
import {
  evaluate,
  initialMonitorState,
  parseMonitorState,
  quorumVerdict,
  type EvaluationPolicy,
  type MonitorState,
  type RegionObservation,
} from "./evaluation.js";
import type { Region } from "./regions.js";
import type { CheckStatus } from "./results.js";

const policy: EvaluationPolicy = {
  regions: ["us-east", "eu-west", "ap-southeast"],
  quorum: 2,
  failThreshold: 2,
  recoverThreshold: 3,
  intervalSeconds: 30,
  flapWindowMs: 20 * 60_000,
  flapThreshold: 4,
};

let clock = Date.parse("2026-05-01T12:00:00Z");

function observe(status: CheckStatus): RegionObservation {
  return {
    status,
    latencyMs: status === "down" ? 0 : 120,
    error: status === "down" ? "ECONNREFUSED" : null,
    at: new Date(clock),
  };
}

function feed(state: MonitorState, round: Partial<Record<Region, CheckStatus>>) {
  let current = state;
  const transitions = [];
  for (const [region, status] of Object.entries(round) as [Region, CheckStatus][]) {
    clock += 1_000;
    const outcome = evaluate(current, region, observe(status), policy, new Date(clock));
    current = outcome.state;
    if (outcome.transition) transitions.push(outcome.transition);
  }
  clock += 30_000 - Object.keys(round).length * 1_000;
  return { state: current, transitions };
}

const healthy = { "us-east": "up", "eu-west": "up", "ap-southeast": "up" } as const;
const outage = { "us-east": "down", "eu-west": "down", "ap-southeast": "down" } as const;

describe("quorumVerdict", () => {
  it("needs a quorum of fresh regions before deciding", () => {
    expect(quorumVerdict({ up: 1, degraded: 0, down: 0, fresh: 1 }, 2, 3)).toBe("insufficient");
    expect(quorumVerdict({ up: 1, degraded: 0, down: 1, fresh: 2 }, 2, 3)).toBe("up");
    expect(quorumVerdict({ up: 1, degraded: 1, down: 1, fresh: 3 }, 2, 3)).toBe("degraded");
    expect(quorumVerdict({ up: 0, degraded: 1, down: 2, fresh: 3 }, 2, 3)).toBe("down");
  });
});

describe("evaluate", () => {
  it("moves from pending to up once the first full round reports healthy", () => {
    const { state, transitions } = feed(initialMonitorState(), healthy);
    expect(state.status).toBe("up");
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.from).toBe("pending");
  });

  it("ignores a single failing region", () => {
    let { state } = feed(initialMonitorState(), healthy);
    for (let i = 0; i < 5; i++) {
      ({ state } = feed(state, { "us-east": "down", "eu-west": "up", "ap-southeast": "up" }));
    }
    expect(state.status).toBe("up");
  });

  it("does not transition on a single round where the quorum fails", () => {
    let { state } = feed(initialMonitorState(), healthy);
    ({ state } = feed(state, { "us-east": "down", "eu-west": "down", "ap-southeast": "up" }));
    expect(state.status).toBe("up");
    expect(state.streakVerdict).toBe("down");
    expect(state.streakCount).toBe(1);
    ({ state } = feed(state, healthy));
    expect(state.status).toBe("up");
    expect(state.transitions).toHaveLength(0);
  });

  it("counts each probe round once, however many regions report in it", () => {
    let { state } = feed(initialMonitorState(), healthy);
    clock += 1_000;
    let outcome = evaluate(state, "us-east", observe("down"), policy, new Date(clock));
    expect(outcome.roundClosed).toBe(false);
    clock += 1_000;
    outcome = evaluate(outcome.state, "eu-west", observe("down"), policy, new Date(clock));
    expect(outcome.verdict).toBe("down");
    expect(outcome.roundClosed).toBe(false);
    clock += 1_000;
    outcome = evaluate(outcome.state, "ap-southeast", observe("down"), policy, new Date(clock));
    expect(outcome.roundClosed).toBe(true);
    expect(outcome.transition).toBeNull();
    expect(outcome.state.streakCount).toBe(1);
    clock += 28_000;

    ({ state } = feed(outcome.state, outage));
    expect(state.status).toBe("down");
    expect(state.pendingReaction).toMatchObject({ from: "up", to: "down" });
  });

  it("closes a round early when a region reports twice", () => {
    let { state } = feed(initialMonitorState(), healthy);
    for (const status of ["down", "down", "down"] as const) {
      clock += 1_000;
      state = evaluate(state, "us-east", observe(status), policy, new Date(clock)).state;
      clock += 1_000;
      state = evaluate(state, "eu-west", observe(status), policy, new Date(clock)).state;
      clock += 28_000;
    }
    expect(state.status).toBe("down");
  });

  it("requires recoverThreshold healthy rounds before recovering", () => {
    let { state } = feed(initialMonitorState(), healthy);
    ({ state } = feed(state, outage));
    ({ state } = feed(state, outage));
    expect(state.status).toBe("down");

    ({ state } = feed(state, healthy));
    ({ state } = feed(state, healthy));
    expect(state.okStreak).toBe(2);
    expect(state.status).toBe("down");

    ({ state } = feed(state, healthy));
    expect(state.status).toBe("up");
  });

  it("drops stale regions from the vote", () => {
    let { state } = feed(initialMonitorState(), healthy);
    clock += 10 * 60_000;
    const outcome = evaluate(state, "us-east", observe("down"), policy, new Date(clock));
    expect(outcome.votes.fresh).toBe(1);
    expect(outcome.verdict).toBe("insufficient");
    state = outcome.state;
    expect(state.status).toBe("up");
  });

  it("does not wait for a region whose worker went quiet", () => {
    let { state } = feed(initialMonitorState(), healthy);
    for (let i = 0; i < 4; i++) ({ state } = feed(state, { "us-east": "up", "eu-west": "up" }));
    for (let i = 0; i < 2; i++) {
      ({ state } = feed(state, { "us-east": "down", "eu-west": "down" }));
    }
    expect(state.status).toBe("down");
  });

  it("ignores results that arrive out of order", () => {
    const { state } = feed(initialMonitorState(), healthy);
    const late = { ...observe("down"), at: new Date(clock - 120_000) };
    const outcome = evaluate(state, "us-east", late, policy, new Date(clock));
    expect(outcome.state).toBe(state);
  });

  it("ignores a redelivered result instead of counting it twice", () => {
    let { state } = feed(initialMonitorState(), healthy);
    ({ state } = feed(state, { "us-east": "down", "eu-west": "down", "ap-southeast": "down" }));
    const at = new Date(clock - 30_000);
    const duplicate = { status: "down" as const, latencyMs: 0, error: "ECONNREFUSED", at };
    const outcome = evaluate(state, "ap-southeast", duplicate, policy, new Date(clock));
    expect(outcome.state).toBe(state);
    expect(outcome.state.streakCount).toBe(1);
  });

  it("flags flapping and doubles the recovery requirement", () => {
    let { state } = feed(initialMonitorState(), healthy);
    for (let i = 0; i < 2; i++) {
      for (let r = 0; r < 2; r++) ({ state } = feed(state, outage));
      for (let r = 0; r < 3; r++) ({ state } = feed(state, healthy));
    }
    expect(state.transitions.length).toBeGreaterThanOrEqual(4);
    expect(state.flapping).toBe(true);

    for (let r = 0; r < 2; r++) ({ state } = feed(state, outage));
    expect(state.status).toBe("down");
    for (let r = 0; r < 5; r++) ({ state } = feed(state, healthy));
    expect(state.okStreak).toBe(5);
    expect(state.status).toBe("down");
    ({ state } = feed(state, healthy));
    expect(state.status).toBe("up");
  });
});

describe("parseMonitorState", () => {
  it("fills fields missing from documents written by older versions", () => {
    const state = parseMonitorState({
      status: "up",
      since: "2026-05-01T12:00:00.000Z",
      regions: { "us-east": { status: "up", latencyMs: 12, error: null, at: "2026-05-01T12:00:00Z" } },
      streakVerdict: "up",
      streakCount: 4,
      okStreak: 4,
      transitions: [],
      flapping: false,
      lastCheckedAt: null,
      version: 7,
    });
    expect(state.roundRegions).toEqual([]);
    expect(state.pendingReaction).toBeNull();
    expect(state.regions["us-east"]?.at).toBeInstanceOf(Date);
    expect(state.version).toBe(7);
    expect(parseMonitorState(null)).toEqual(initialMonitorState());
  });
});
