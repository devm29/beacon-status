import { describe, expect, it } from "vitest";
import { placeholderTarget, redactTarget } from "./channel.js";
import {
  BeaconConfigSchema,
  StatusPageSpecSchema,
  planConfig,
  stableStringify,
  type CurrentState,
} from "./config.js";
import { isPublicEvent } from "./events.js";
import { bucketIndex, mergeHistograms, percentileFromHistogram, emptyHistogram } from "./histogram.js";
import {
  DEFAULT_AUTOMATION_POLICY,
  assertTransition,
  canTransition,
  decideAutomation,
  type IncidentSnapshot,
} from "./incident.js";
import { MonitorSpecSchema } from "./monitor.js";
import { budgetBurndown, burnPoliciesFor, burnRate, errorBudget, evaluateBurnPolicies } from "./slo.js";
import { buildUptimeDays, overallUptime } from "./uptime.js";

describe("incident state machine", () => {
  it("allows forward progress and reopening, but not resurrecting into identified", () => {
    expect(canTransition("investigating", "identified")).toBe(true);
    expect(canTransition("monitoring", "investigating")).toBe(true);
    expect(canTransition("resolved", "investigating")).toBe(true);
    expect(canTransition("resolved", "monitoring")).toBe(false);
    expect(canTransition("resolved", "resolved")).toBe(true);
    expect(() => assertTransition("resolved", "identified")).toThrow(
      /cannot move from resolved to identified/,
    );
  });

  const now = new Date("2026-05-01T12:00:00Z");
  const base: IncidentSnapshot = {
    status: "investigating",
    autoResolve: true,
    statusChangedAt: new Date(now.getTime() - 60_000),
    resolvedAt: null,
  };

  it("moves to monitoring on recovery, then resolves after the cool-down", () => {
    const recovered = decideAutomation(
      base,
      { kind: "monitor_recovered", monitorName: "API" },
      DEFAULT_AUTOMATION_POLICY,
      now,
    );
    expect(recovered?.status).toBe("monitoring");

    const monitoring = { ...base, status: "monitoring" as const, statusChangedAt: now };
    const tooSoon = new Date(now.getTime() + 60_000);
    expect(
      decideAutomation(
        monitoring,
        { kind: "stable", monitorName: "API" },
        DEFAULT_AUTOMATION_POLICY,
        tooSoon,
      ),
    ).toBeNull();
    const later = new Date(now.getTime() + DEFAULT_AUTOMATION_POLICY.resolveAfterMs);
    expect(
      decideAutomation(monitoring, { kind: "stable", monitorName: "API" }, DEFAULT_AUTOMATION_POLICY, later)
        ?.status,
    ).toBe("resolved");
  });

  it("never auto-resolves when an operator turned it off", () => {
    const pinned = {
      ...base,
      status: "monitoring" as const,
      autoResolve: false,
      statusChangedAt: new Date(0),
    };
    expect(
      decideAutomation(pinned, { kind: "stable", monitorName: "API" }, DEFAULT_AUTOMATION_POLICY, now),
    ).toBeNull();
  });

  it("reopens a recently resolved incident but not an old one", () => {
    const resolved = {
      ...base,
      status: "resolved" as const,
      resolvedAt: new Date(now.getTime() - 5 * 60_000),
    };
    const signal = { kind: "monitor_down" as const, monitorName: "API", votes: "3/3 regions" };
    expect(decideAutomation(resolved, signal, DEFAULT_AUTOMATION_POLICY, now)?.status).toBe("investigating");
    const old = { ...resolved, resolvedAt: new Date(now.getTime() - 60 * 60_000) };
    expect(decideAutomation(old, signal, DEFAULT_AUTOMATION_POLICY, now)).toBeNull();
  });

  it("does not add noise for repeated failures while investigating", () => {
    const signal = { kind: "monitor_down" as const, monitorName: "API", votes: "2/3 regions" };
    expect(decideAutomation(base, signal, DEFAULT_AUTOMATION_POLICY, now)).toBeNull();
  });
});

describe("latency histogram", () => {
  it("merges element-wise and estimates percentiles", () => {
    const a = emptyHistogram();
    const b = emptyHistogram();
    for (const ms of [10, 20, 40, 80, 90]) a[bucketIndex(ms)] = (a[bucketIndex(ms)] ?? 0) + 1;
    for (const ms of [120, 150, 900, 20_000]) b[bucketIndex(ms)] = (b[bucketIndex(ms)] ?? 0) + 1;
    const merged = mergeHistograms([a, b]);
    expect(merged.reduce((s, n) => s + n, 0)).toBe(9);
    const p50 = percentileFromHistogram(merged, 0.5, 20_000);
    expect(p50).toBeGreaterThanOrEqual(50);
    expect(p50).toBeLessThanOrEqual(100);
    expect(percentileFromHistogram(merged, 1, 20_000)).toBe(20_000);
    expect(percentileFromHistogram(emptyHistogram(), 0.95, 0)).toBeNull();
  });
});

describe("SLO math", () => {
  it("computes burn rates relative to the allowed error ratio", () => {
    expect(burnRate({ good: 999, total: 1000 }, 99.9)).toBeCloseTo(1);
    expect(burnRate({ good: 990, total: 1000 }, 99.9)).toBeCloseTo(10);
    expect(burnRate({ good: 0, total: 0 }, 99.9)).toBe(0);
  });

  it("reports remaining budget and breaches", () => {
    expect(errorBudget({ good: 9995, total: 10_000 }, 99.9).remaining).toBeCloseTo(0.5);
    expect(errorBudget({ good: 9980, total: 10_000 }, 99.9).remaining).toBeCloseTo(-1);
  });

  it("only fires a burn alert when both windows exceed the threshold", () => {
    const results = evaluateBurnPolicies(
      (windowMs) => (windowMs <= 5 * 60_000 ? { good: 100, total: 100 } : { good: 900, total: 1000 }),
      99.9,
    );
    expect(results[0]?.longBurn).toBeCloseTo(100);
    expect(results[0]?.firing).toBe(false);
    const hot = evaluateBurnPolicies(() => ({ good: 900, total: 1000 }), 99.9);
    expect(hot.every((r) => r.firing)).toBe(true);
  });

  it("builds a cumulative burndown", () => {
    const points = budgetBurndown(
      [
        { start: new Date("2026-05-01"), good: 1000, total: 1000 },
        { start: new Date("2026-05-02"), good: 999, total: 1000 },
      ],
      99.9,
    );
    expect(points[0]?.remaining).toBe(1);
    expect(points[1]?.remaining).toBeCloseTo(0.5);
  });
});

describe("uptime bar", () => {
  it("fills missing days and lets incidents darken a day", () => {
    const now = new Date("2026-05-10T15:00:00Z");
    const days = buildUptimeDays(
      [
        { start: new Date("2026-05-09T00:00:00Z"), total: 1000, up: 1000, degraded: 0, down: 0 },
        { start: new Date("2026-05-10T00:00:00Z"), total: 1000, up: 960, degraded: 10, down: 30 },
      ],
      [
        {
          id: "i1",
          title: "API outage",
          impact: "critical",
          startedAt: new Date("2026-05-09T23:50:00Z"),
          resolvedAt: new Date("2026-05-10T00:20:00Z"),
        },
      ],
      3,
      now,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-05-08", "2026-05-09", "2026-05-10"]);
    expect(days[0]?.level).toBe("nodata");
    expect(days[1]?.level).toBe("major");
    expect(days[2]?.uptime).toBeCloseTo(0.97);
    expect(overallUptime(days)).toBeCloseTo(0.985);
  });
});

describe("monitor spec", () => {
  it("applies sensible defaults", () => {
    const spec = MonitorSpecSchema.parse({
      key: "api",
      name: "API",
      check: { type: "http", url: "https://example.com" },
    });
    expect(spec.regions).toHaveLength(3);
    expect(spec.quorum).toBe(2);
    expect(spec.check).toMatchObject({ method: "GET", expectedStatus: ["2xx"] });
  });

  it("rejects a quorum larger than the region set", () => {
    const result = MonitorSpecSchema.safeParse({
      key: "api",
      name: "API",
      regions: ["us-east"],
      quorum: 2,
      check: { type: "tcp", host: "db.internal", port: 5432 },
    });
    expect(result.success).toBe(false);
  });
});

describe("config planning", () => {
  const config = BeaconConfigSchema.parse({
    version: 1,
    monitors: [
      { key: "api", name: "API", check: { type: "http", url: "https://api.example.com/health" } },
      { key: "db", name: "Database", check: { type: "tcp", host: "db", port: 5432 } },
    ],
    slos: [{ key: "api-availability", name: "API availability", monitor: "api", target: 99.9 }],
  });

  it("validates cross references", () => {
    const result = BeaconConfigSchema.safeParse({
      version: 1,
      monitors: [],
      slos: [{ key: "x", name: "X", monitor: "missing", target: 99 }],
    });
    expect(result.success).toBe(false);
  });

  it("plans creates, updates, adoption and pruning", () => {
    const [api, db] = config.monitors;
    if (!api || !db) throw new Error("fixture");
    const current: CurrentState = {
      statusPage: { title: "Status", description: "", groups: [], supportUrl: null },
      monitors: [
        { ...api, intervalSeconds: 120, managedBy: "config" },
        { ...db, managedBy: "ui" },
        { ...db, key: "legacy", managedBy: "config" },
        { ...db, key: "handmade", managedBy: "ui" },
      ],
      slos: [],
      channels: [],
    };
    const plan = planConfig(config, current, { prune: true });
    const byKey = Object.fromEntries(plan.changes.map((c) => [`${c.kind}:${c.key}`, c]));
    expect(byKey["monitor:api"]?.action).toBe("update");
    expect(byKey["monitor:api"]?.changes).toEqual([{ path: "intervalSeconds", before: 120, after: 60 }]);
    expect(byKey["monitor:db"]?.changes.at(-1)).toEqual({ path: "managedBy", before: "ui", after: "config" });
    expect(byKey["monitor:legacy"]?.action).toBe("delete");
    expect(byKey["monitor:handmade"]).toBeUndefined();
    expect(byKey["slo:api-availability"]?.action).toBe("create");
    expect(plan.summary).toEqual({ create: 1, update: 2, delete: 1 });
  });

  it("serializes deterministically", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });
});

describe("burn policies", () => {
  it("keep the workbook thresholds for 30 days and scale with the window", () => {
    expect(burnPoliciesFor(30).map((p) => p.threshold)).toEqual([14.4, 6, 3, 1]);
    const ninety = burnPoliciesFor(90);
    expect(ninety[0]?.threshold).toBeCloseTo(43.2);
    expect(burnPoliciesFor(7).every((p) => p.threshold >= 1)).toBe(true);
    expect(burnPoliciesFor(7)[0]?.threshold).toBeCloseTo(3.36);
  });
});

describe("channel targets", () => {
  const webhook = {
    type: "webhook" as const,
    url: "https://hooks.example.com/beacon",
    secret: "a-very-secret-signing-key",
    headers: { Authorization: "Bearer token-123" },
  };

  it("never exposes header values or signing secrets when redacted", () => {
    const redacted = redactTarget(webhook);
    expect(JSON.stringify(redacted)).not.toContain("token-123");
    expect(JSON.stringify(redacted)).not.toContain("a-very-secret");
    expect(redacted).toMatchObject({ headers: { Authorization: "********" } });
  });

  it("exports placeholders that cannot be applied without expanding them", () => {
    const exported = placeholderTarget("ops-hook", webhook);
    expect(exported).toEqual({
      type: "webhook",
      url: "${CHANNEL_OPS_HOOK_URL}",
      secret: "${CHANNEL_OPS_HOOK_SECRET}",
      headers: { Authorization: "${CHANNEL_OPS_HOOK_HEADER_AUTHORIZATION}" },
    });
    const config = {
      version: 1,
      channels: [{ key: "ops-hook", name: "Ops", target: exported }],
    };
    expect(BeaconConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe("status page spec", () => {
  it("only accepts http(s) support links", () => {
    expect(StatusPageSpecSchema.safeParse({ title: "x", supportUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      StatusPageSpecSchema.safeParse({ title: "x", supportUrl: "https://help.example.com" }).success,
    ).toBe(true);
  });
});

describe("isPublicEvent", () => {
  const incident = {
    type: "incident.changed" as const,
    orgId: "o",
    incidentId: "i",
    change: "opened" as const,
    title: "Internal admin is down",
    status: "investigating" as const,
    impact: "major" as const,
    at: new Date().toISOString(),
  };

  it("hides incidents that only touch private monitors", () => {
    expect(isPublicEvent({ ...incident, public: false })).toBe(false);
    expect(isPublicEvent({ ...incident, public: true })).toBe(true);
  });
});
