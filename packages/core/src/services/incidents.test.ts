import { initialMonitorState } from "@beacon/shared";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryEventPublisher } from "../event-bus.js";
import {
  ChannelModel,
  IncidentModel,
  IncidentUpdateModel,
  MaintenanceModel,
  MonitorModel,
  NotificationModel,
  type MonitorDoc,
} from "../models/index.js";
import { MaintenanceRepository } from "../repositories/maintenance.js";
import { connectTestDatabase, testLogger } from "../testing/index.js";
import { AlertDispatcher, memoryDedupStore, type DeliveryScheduler } from "./alerts.js";
import { IncidentService } from "./incidents.js";

describe("IncidentService automation", () => {
  let drop: () => Promise<void>;
  let events: MemoryEventPublisher;
  let scheduled: { id: string; delayMs: number }[];
  let service: IncidentService;
  let monitor: MonitorDoc;
  const orgId = new Types.ObjectId();
  const t0 = new Date("2026-04-01T10:00:00Z");
  const policy = { resolveAfterMs: 120_000, reopenWindowMs: 600_000 };

  beforeAll(async () => {
    ({ drop } = await connectTestDatabase());
  });
  afterAll(async () => drop());

  beforeEach(async () => {
    await Promise.all([
      IncidentModel.deleteMany({}),
      IncidentUpdateModel.deleteMany({}),
      NotificationModel.deleteMany({}),
      ChannelModel.deleteMany({}),
      MaintenanceModel.deleteMany({}),
      MonitorModel.deleteMany({}),
    ]);
    events = new MemoryEventPublisher();
    scheduled = [];
    const delivery: DeliveryScheduler = {
      schedule: (id, delayMs) => {
        scheduled.push({ id, delayMs });
        return Promise.resolve();
      },
    };
    const alerts = new AlertDispatcher({
      dedup: memoryDedupStore(),
      delivery,
      maintenance: new MaintenanceRepository(),
      logger: testLogger(),
    });
    service = new IncidentService({
      events,
      alerts,
      logger: testLogger(),
      dashboardUrl: "http://dash",
      policy,
    });
    const created = await MonitorModel.create({
      orgId,
      key: "checkout",
      name: "Checkout",
      group: "Payments",
      check: { type: "http", url: "http://example.test" },
      intervalSeconds: 30,
      timeoutMs: 5000,
      regions: ["us-east", "eu-west", "ap-southeast"],
      quorum: 2,
      failThreshold: 2,
      recoverThreshold: 3,
      state: initialMonitorState(),
    });
    monitor = created.toObject<MonitorDoc>();
    await ChannelModel.create([
      {
        orgId,
        key: "pager",
        name: "Pager",
        target: { type: "webhook", url: "http://hook.test", headers: {} },
        events: ["incident.opened", "incident.updated", "incident.resolved"],
        escalationDelaySeconds: 0,
      },
      {
        orgId,
        key: "managers",
        name: "Managers",
        target: { type: "email", to: ["boss@example.test"] },
        events: ["incident.opened", "incident.resolved"],
        escalationDelaySeconds: 300,
      },
    ]);
  });

  const at = (ms: number) => new Date(t0.getTime() + ms);
  const down = { votes: "3 of 3 regions", detail: "Connection refused.", flapping: false };

  it("walks the full lifecycle and alerts every channel", async () => {
    const incident = await service.onMonitorDown(monitor, down, at(0));
    expect(incident.status).toBe("investigating");
    expect(scheduled.map((s) => s.delayMs).sort((a, b) => a - b)).toEqual([0, 300_000]);

    await service.onMonitorDown(monitor, down, at(30_000));
    expect(await IncidentModel.countDocuments()).toBe(1);

    await service.onMonitorRecovered(monitor, at(60_000));
    await service.onMonitorStable(monitor, at(90_000), false);
    expect((await IncidentModel.findById(incident._id).lean())?.status).toBe("monitoring");

    await service.onMonitorStable(monitor, at(60_000 + 120_000), false);
    const resolved = await IncidentModel.findById(incident._id).lean();
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt?.toISOString()).toBe(at(180_000).toISOString());

    const timeline = await IncidentUpdateModel.find({ incidentId: incident._id })
      .sort({ createdAt: 1 })
      .lean();
    expect(timeline.map((u) => u.status)).toEqual(["investigating", "monitoring", "resolved"]);
    expect(
      events.published
        .filter((e) => e.type === "incident.changed")
        .map((e) => e.type === "incident.changed" && e.change),
    ).toEqual(["opened", "updated", "resolved"]);
  });

  it("reopens instead of opening a second incident when the monitor fails again quickly", async () => {
    const first = await service.onMonitorDown(monitor, down, at(0));
    await service.onMonitorRecovered(monitor, at(10_000));
    await service.onMonitorStable(monitor, at(200_000), false);
    const again = await service.onMonitorDown(monitor, down, at(260_000));
    expect(again._id.equals(first._id)).toBe(true);
    expect((await IncidentModel.findById(first._id).lean())?.status).toBe("investigating");
    expect(await IncidentModel.countDocuments()).toBe(1);
  });

  it("suppresses alerts during maintenance but still records the incident", async () => {
    await MaintenanceModel.create({
      orgId,
      title: "Database upgrade",
      startsAt: at(-60_000),
      endsAt: at(3_600_000),
      monitors: ["checkout"],
    });
    await service.onMonitorDown(monitor, down, at(0));
    const notifications = await NotificationModel.find().lean();
    expect(notifications).toHaveLength(2);
    expect(notifications.every((n) => n.status === "suppressed" && n.reason?.startsWith("maintenance"))).toBe(
      true,
    );
    expect(scheduled).toHaveLength(0);
  });

  it("does not auto-resolve while the monitor is flapping", async () => {
    const incident = await service.onMonitorDown(monitor, down, at(0));
    await service.onMonitorRecovered(monitor, at(10_000));
    await service.onMonitorStable(monitor, at(500_000), true);
    expect((await IncidentModel.findById(incident._id).lean())?.status).toBe("monitoring");
  });

  it("validates manual transitions", async () => {
    const incident = await service.createManual(
      orgId,
      {
        title: "Elevated errors",
        impact: "minor",
        status: "investigating",
        message: "Looking into it",
        monitorIds: [],
      },
      "ops@example.test",
    );
    await service.addManualUpdate(
      orgId,
      incident._id,
      { status: "resolved", message: "Fixed" },
      "ops@example.test",
    );
    await expect(
      service.addManualUpdate(
        orgId,
        incident._id,
        { status: "identified", message: "Nope" },
        "ops@example.test",
      ),
    ).rejects.toThrow(/cannot move from resolved to identified/);
  });

  it("pages again when an incident reopens shortly after resolving", async () => {
    const first = await service.onMonitorDown(monitor, down, at(0));
    await service.onMonitorRecovered(monitor, at(10_000));
    await service.onMonitorStable(monitor, at(200_000), false);
    await service.onMonitorDown(monitor, down, at(260_000));
    const opened = await NotificationModel.find({ incidentId: first._id, event: "incident.opened" }).lean();
    expect(opened.filter((n) => n.status === "pending")).toHaveLength(4);
    const resolved = await NotificationModel.countDocuments({ event: "incident.resolved" });
    expect(resolved).toBe(2);
  });

  it("holds the page while flapping, then sends it if the outage persists", async () => {
    const incident = await service.onMonitorDown(monitor, { ...down, flapping: true }, at(0));
    const held = await NotificationModel.find({ event: "incident.opened" }).lean();
    expect(held.every((n) => n.status === "suppressed" && n.reason === "flapping")).toBe(true);
    expect((await IncidentModel.findById(incident._id).lean())?.pageDeferred).toBe(true);

    const flapping = { ...monitor, state: { ...monitor.state, flapping: true } };
    const resolveMonitors = () => Promise.resolve([flapping]);
    expect(await service.releaseDeferredPages(at(60_000), resolveMonitors)).toBe(0);

    expect(await service.releaseDeferredPages(at(11 * 60_000), resolveMonitors)).toBe(1);
    const sent = await NotificationModel.find({ event: "incident.opened", status: "pending" }).lean();
    expect(sent).toHaveLength(2);
    expect((await IncidentModel.findById(incident._id).lean())?.pageDeferred).toBe(false);
    expect(await service.releaseDeferredPages(at(12 * 60_000), resolveMonitors)).toBe(0);
  });

  it("never sends a held page for an incident that already resolved", async () => {
    const incident = await service.onMonitorDown(monitor, { ...down, flapping: true }, at(0));
    await service.addManualUpdate(orgId, incident._id, { status: "resolved", message: "Fixed" }, "ops");
    expect(await service.releaseDeferredPages(at(60 * 60_000), () => Promise.resolve([monitor]))).toBe(0);
  });

  it("scopes manual incidents to their monitors for channels and maintenance", async () => {
    await ChannelModel.create({
      orgId,
      key: "search-team",
      name: "Search team",
      target: { type: "webhook", url: "http://search.test", headers: {} },
      events: ["incident.opened"],
      monitors: ["search"],
    });
    await MaintenanceModel.create({
      orgId,
      title: "Checkout migration",
      startsAt: at(-60_000),
      endsAt: at(3_600_000),
      monitors: ["checkout"],
    });
    await service.createManual(
      orgId,
      {
        title: "Checkout errors",
        impact: "major",
        status: "investigating",
        message: "Looking",
        monitorIds: [monitor._id],
      },
      "ops",
      at(0),
    );
    const notifications = await NotificationModel.find().lean();
    expect(notifications).toHaveLength(2);
    expect(notifications.every((n) => n.status === "suppressed")).toBe(true);
  });

  it("adds notes to resolved incidents without reopening them", async () => {
    const incident = await service.createManual(
      orgId,
      {
        title: "Elevated errors",
        impact: "minor",
        status: "investigating",
        message: "Looking",
        monitorIds: [],
      },
      "ops",
    );
    await service.addManualUpdate(orgId, incident._id, { status: "resolved", message: "Fixed" }, "ops");
    const noted = await service.addManualUpdate(
      orgId,
      incident._id,
      { status: "resolved", message: "Postmortem: https://example.test/pm" },
      "ops",
    );
    expect(noted.status).toBe("resolved");
    const changes = events.published.flatMap((e) => (e.type === "incident.changed" ? [e.change] : []));
    expect(changes).toEqual(["opened", "resolved", "updated"]);
  });

  it("marks incident events on private monitors as not public", async () => {
    await MonitorModel.updateOne({ _id: monitor._id }, { $set: { public: false } });
    await service.onMonitorDown(monitor, down, at(0));
    const [event] = events.published.filter((e) => e.type === "incident.changed");
    expect(event).toMatchObject({ public: false });
  });
});
