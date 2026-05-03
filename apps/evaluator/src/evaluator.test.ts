import {
  AlertDispatcher,
  ChannelModel,
  IncidentModel,
  IncidentService,
  MaintenanceModel,
  MaintenanceRepository,
  MemoryEventPublisher,
  MonitorModel,
  MonitorRepository,
  NotificationModel,
  RollupService,
  SloService,
  memoryDedupStore,
  unrestrictedEgress,
  type MonitorDoc,
  type ResultJobData,
} from "@beacon/core";
import { connectTestDatabase, testLogger } from "@beacon/core/testing";
import { MonitorSpecSchema, type CheckStatus, type Region } from "@beacon/shared";
import { createHmac } from "node:crypto";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DeliveryService } from "./delivery-service.js";
import { MaintenanceRunner } from "./maintenance-runner.js";
import { EvaluationService } from "./evaluation-service.js";
import { ProviderRegistry } from "./providers/registry.js";
import { slackPayload } from "./providers/slack.js";
import { DeliveryError, type DeliveryMessage, type NotificationProvider } from "./providers/types.js";
import { WebhookProvider, signPayload } from "./providers/webhook.js";

const logger = testLogger();

class RecordingProvider<T extends "email" | "slack" | "discord" | "webhook"> implements NotificationProvider {
  sent: DeliveryMessage[] = [];
  failWith: Error | null = null;
  constructor(readonly type: T) {}
  send(_target: unknown, message: DeliveryMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve();
  }
}

describe("evaluator", () => {
  let drop: () => Promise<void>;
  let monitor: MonitorDoc;
  let events: MemoryEventPublisher;
  let scheduled: string[];
  let evaluation: EvaluationService;
  let incidents: IncidentService;
  let alerts: AlertDispatcher;
  let runner: MaintenanceRunner;
  let failNextIncident: boolean;
  let clock: number;
  const slack = new RecordingProvider("slack");
  const registry = new ProviderRegistry({
    email: new RecordingProvider("email"),
    slack: slack,
    discord: new RecordingProvider("discord"),
    webhook: new RecordingProvider("webhook"),
  });
  const delivery = new DeliveryService(registry, logger);

  beforeAll(async () => {
    ({ drop } = await connectTestDatabase());
  });
  afterAll(async () => drop());

  beforeEach(async () => {
    await Promise.all([
      MonitorModel.deleteMany({}),
      IncidentModel.deleteMany({}),
      NotificationModel.deleteMany({}),
      ChannelModel.deleteMany({}),
      MaintenanceModel.deleteMany({}),
    ]);
    slack.sent = [];
    slack.failWith = null;
    clock = Date.parse("2026-06-01T09:00:00Z");
    scheduled = [];
    events = new MemoryEventPublisher();
    const monitors = new MonitorRepository();
    const maintenance = new MaintenanceRepository();
    failNextIncident = false;
    alerts = new AlertDispatcher({
      dedup: memoryDedupStore(),
      delivery: {
        schedule: (id) => {
          scheduled.push(id);
          return Promise.resolve();
        },
      },
      maintenance,
      logger,
    });
    incidents = new IncidentService({ events, alerts, logger, dashboardUrl: "http://dash" });
    const flakyIncidents = Object.create(incidents) as IncidentService;
    flakyIncidents.onMonitorDown = (...args) => {
      if (failNextIncident) {
        failNextIncident = false;
        return Promise.reject(new Error("mongo blip"));
      }
      return incidents.onMonitorDown(...args);
    };
    evaluation = new EvaluationService({
      monitors,
      incidents: flakyIncidents,
      alerts,
      maintenance,
      events,
      logger,
      flap: { flapWindowMs: 20 * 60_000, flapThreshold: 4 },
      dashboardUrl: "http://dash",
      now: () => new Date(clock),
    });
    runner = new MaintenanceRunner({
      rollups: new RollupService(),
      slos: new SloService(),
      incidents,
      monitors,
      scheduler: { reconcile: () => Promise.resolve({ synced: 0, removed: 0 }) },
      evaluation,
      alerts,
      logger,
      dashboardUrl: "http://dash",
    });
    const spec = MonitorSpecSchema.parse({
      key: "api",
      name: "Public API",
      intervalSeconds: 30,
      check: { type: "http", url: "http://api.test/health" },
    });
    const orgId = new Types.ObjectId();
    monitor = await monitors.create(orgId, spec, "ui");
    await ChannelModel.create({
      orgId,
      key: "ops-slack",
      name: "Ops Slack",
      target: { type: "slack", url: "http://hooks.test/slack" },
      events: ["incident.opened", "incident.updated", "incident.resolved"],
    });
  });

  function result(region: Region, status: CheckStatus): ResultJobData {
    return {
      monitorId: monitor._id.toHexString(),
      orgId: monitor.orgId.toHexString(),
      region,
      status,
      latencyMs: status === "down" ? 10_000 : 80,
      error: status === "down" ? "Connection refused" : null,
      details: {},
      checkedAt: new Date(clock).toISOString(),
    };
  }

  async function round(statuses: Partial<Record<Region, CheckStatus>>) {
    const outcomes = await Promise.all(
      Object.entries(statuses).map(([region, status]) => evaluation.handle(result(region as Region, status))),
    );
    clock += 30_000;
    return outcomes;
  }

  const all = (status: CheckStatus) => ({ "us-east": status, "eu-west": status, "ap-southeast": status });

  it("survives concurrent results and opens exactly one incident on quorum failure", async () => {
    await round(all("up"));
    await round({ "us-east": "down", "eu-west": "up", "ap-southeast": "up" });
    expect(await IncidentModel.countDocuments()).toBe(0);

    await round(all("down"));
    await round(all("down"));
    const stored = await MonitorModel.findById(monitor._id).lean<MonitorDoc>();
    expect(stored?.state.status).toBe("down");
    // Twelve results plus the acknowledgement of two transitions (pending -> up -> down).
    expect(stored?.state.version).toBe(14);
    expect(stored?.state.pendingReaction).toBeNull();
    expect(await IncidentModel.countDocuments()).toBe(1);
    expect(events.published.some((e) => e.type === "monitor.status" && e.to === "down")).toBe(true);
    expect(scheduled).toHaveLength(1);
  });

  it("delivers the page, then follows up only on channels that were paged", async () => {
    await round(all("up"));
    await round(all("down"));
    await round(all("down"));
    const [opened] = await NotificationModel.find({ event: "incident.opened" }).lean();
    if (!opened) throw new Error("expected a notification");
    expect(await delivery.deliver(opened._id.toHexString(), { finalAttempt: false })).toEqual({
      status: "sent",
      reason: null,
    });
    expect(slack.sent[0]?.subject).toBe("[Incident] Public API is unavailable");

    for (let i = 0; i < 3; i++) await round(all("up"));
    const incident = await IncidentModel.findOne().lean();
    expect(incident?.status).toBe("monitoring");
    const [update] = await NotificationModel.find({ event: "incident.updated" }).lean();
    if (!update) throw new Error("expected an update notification");
    expect((await delivery.deliver(update._id.toHexString(), { finalAttempt: false }))?.status).toBe("sent");
  });

  it("skips follow-ups for channels that were never paged and records failures", async () => {
    await round(all("up"));
    await round(all("down"));
    await round(all("down"));
    const [opened] = await NotificationModel.find({ event: "incident.opened" }).lean();
    if (!opened) throw new Error("expected a notification");

    slack.failWith = new DeliveryError("Endpoint responded with HTTP 500", true);
    await expect(delivery.deliver(opened._id.toHexString(), { finalAttempt: false })).rejects.toThrow(
      /HTTP 500/,
    );
    expect((await delivery.deliver(opened._id.toHexString(), { finalAttempt: true }))?.status).toBe("failed");

    slack.failWith = null;
    for (let i = 0; i < 3; i++) await round(all("up"));
    const [update] = await NotificationModel.find({ event: "incident.updated" }).lean();
    if (!update) throw new Error("expected an update notification");
    expect(await delivery.deliver(update._id.toHexString(), { finalAttempt: false })).toEqual({
      status: "skipped",
      reason: "This channel was never paged for the incident",
    });
  });

  it("does not open incidents during maintenance", async () => {
    await MaintenanceModel.create({
      orgId: monitor.orgId,
      title: "Planned failover",
      startsAt: new Date(clock - 60_000),
      endsAt: new Date(clock + 3_600_000),
      monitors: [],
    });
    await round(all("up"));
    await round(all("down"));
    await round(all("down"));
    expect((await MonitorModel.findById(monitor._id).lean<MonitorDoc>())?.state.status).toBe("down");
    expect(await IncidentModel.countDocuments()).toBe(0);
  });

  it("does not open an incident for one bad round", async () => {
    await round(all("up"));
    await round({ "us-east": "down", "eu-west": "down", "ap-southeast": "up" });
    await round(all("up"));
    expect((await MonitorModel.findById(monitor._id).lean<MonitorDoc>())?.state.status).toBe("up");
    expect(await IncidentModel.countDocuments()).toBe(0);
  });

  it("counts a redelivered result once", async () => {
    await round(all("up"));
    const message = result("us-east", "down");
    const first = await evaluation.handle(message);
    const again = await evaluation.handle(message);
    expect(first?.state.version).toBeGreaterThan(0);
    expect(again?.state).toEqual((await MonitorModel.findById(monitor._id).lean<MonitorDoc>())?.state);
    expect(again?.state.roundRegions).toEqual(["us-east"]);
  });

  it("replays a transition whose side effects failed", async () => {
    await round(all("up"));
    await round(all("down"));
    failNextIncident = true;
    await expect(round(all("down"))).rejects.toThrow("mongo blip");
    const stuck = await MonitorModel.findById(monitor._id).lean<MonitorDoc>();
    expect(stuck?.state.status).toBe("down");
    expect(stuck?.state.pendingReaction).toMatchObject({ from: "up", to: "down" });
    expect(await IncidentModel.countDocuments()).toBe(0);

    clock += 60_000;
    await runner.run("incident-sweep", new Date(clock));
    expect(await IncidentModel.countDocuments()).toBe(1);
    const healed = await MonitorModel.findById(monitor._id).lean<MonitorDoc>();
    expect(healed?.state.pendingReaction).toBeNull();
    expect(await NotificationModel.countDocuments({ event: "incident.opened" })).toBe(1);
  });

  it("opens the incident once a maintenance window ends on a monitor that is still down", async () => {
    await MaintenanceModel.create({
      orgId: monitor.orgId,
      title: "Planned failover",
      startsAt: new Date(clock - 60_000),
      endsAt: new Date(clock + 150_000),
      monitors: [],
    });
    await round(all("up"));
    await round(all("down"));
    await round(all("down"));
    await runner.run("incident-sweep", new Date(clock));
    expect(await IncidentModel.countDocuments()).toBe(0);

    await round(all("down"));
    await round(all("down"));
    await round(all("down"));
    await runner.run("incident-sweep", new Date(clock));
    const incident = await IncidentModel.findOne().lean();
    expect(incident?.status).toBe("investigating");
    const opened = await NotificationModel.find({ event: "incident.opened" }).lean();
    expect(opened.map((n) => n.status)).toEqual(["pending"]);

    await IncidentModel.updateOne(
      { _id: incident?._id },
      { $set: { status: "resolved", resolvedAt: new Date(clock) } },
    );
    clock += 30_000;
    await runner.run("incident-sweep", new Date(clock));
    expect(await IncidentModel.countDocuments({ status: { $ne: "resolved" } })).toBe(0);
  });

  it("requeues notifications whose delivery job was lost", async () => {
    await round(all("up"));
    await round(all("down"));
    await round(all("down"));
    expect(scheduled).toHaveLength(1);
    clock += 10 * 60_000;
    await runner.run("incident-sweep", new Date(clock));
    expect(scheduled).toHaveLength(2);
    expect(scheduled[1]).toBe(scheduled[0]);
  });
});

describe("providers", () => {
  const message: DeliveryMessage = {
    id: "n1",
    event: "incident.opened",
    subject: "[Incident] Checkout is unavailable",
    body: "Checkout is failing from 3 of 3 regions.",
    severity: "critical",
    url: "http://dash/incidents/1",
    fields: [{ label: "Impact", value: "major" }],
    createdAt: new Date("2026-06-01T09:00:00Z"),
  };

  it("builds Slack-compatible payloads", () => {
    const payload = slackPayload(message);
    expect(payload.text).toContain("Checkout is unavailable");
    expect(payload.blocks.length).toBeGreaterThanOrEqual(3);
  });

  it("signs generic webhooks with an HMAC receivers can verify", async () => {
    let captured: { headers: Headers; body: string } | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = (_url: string | URL | Request, init?: RequestInit) => {
      captured = {
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      };
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    try {
      const provider = new WebhookProvider(
        { timeoutMs: 1000, egress: unrestrictedEgress },
        () => new Date(1_700_000_000_000),
      );
      await provider.send(
        { type: "webhook", url: "http://hook.test", secret: "s3cret-s3cret-s3cret", headers: {} },
        message,
      );
    } finally {
      globalThis.fetch = original;
    }
    const result = captured as { headers: Headers; body: string } | null;
    if (!result) throw new Error("fetch was not called");
    const expected = createHmac("sha256", "s3cret-s3cret-s3cret")
      .update(`1700000000.${result.body}`)
      .digest("hex");
    expect(result.headers.get("x-beacon-signature")).toBe(`t=1700000000,v1=${expected}`);
    expect(signPayload("k", "{}", 1)).toMatch(/^t=1,v1=[a-f0-9]{64}$/);
    expect(result.headers.get("x-beacon-event")).toBe("incident.opened");
  });
});
