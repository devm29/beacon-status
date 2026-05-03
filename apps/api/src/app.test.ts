import {
  ChannelModel,
  IncidentModel,
  IncidentUpdateModel,
  MemoryEventPublisher,
  MonitorModel,
  NotificationModel,
  OrgModel,
  OrgRepository,
  SloModel,
  memoryDedupStore,
  type MonitorDoc,
} from "@beacon/core";
import { connectTestDatabase, testLogger } from "@beacon/core/testing";
import { PlanResponseSchema } from "@beacon/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { composeContainer } from "./compose.js";
import type { ApiContainer } from "./container.js";
import { verifyRealtimeToken } from "./realtime/token.js";

const KEY = "bk_test_api_key_0123456789";
const OTHER_KEY = "bk_test_other_org_0123456789";
const SECRET = "test-realtime-secret-0123";

const monitorBody = {
  key: "checkout",
  name: "Checkout",
  group: "Storefront",
  check: { type: "http", url: "https://shop.example.com/api/checkout" },
  intervalSeconds: 30,
};

describe("API", () => {
  let drop: () => Promise<void>;
  let app: Express;
  let container: ApiContainer;
  let events: MemoryEventPublisher;
  let synced: string[];
  let removed: string[];
  const auth = { authorization: `Bearer ${KEY}` };

  beforeAll(async () => {
    ({ drop } = await connectTestDatabase());
  });
  afterAll(async () => drop());

  beforeEach(async () => {
    await Promise.all([
      OrgModel.deleteMany({}),
      MonitorModel.deleteMany({}),
      IncidentModel.deleteMany({}),
      IncidentUpdateModel.deleteMany({}),
      SloModel.deleteMany({}),
      ChannelModel.deleteMany({}),
      NotificationModel.deleteMany({}),
    ]);
    const orgs = new OrgRepository();
    const statusPage = { title: "Acme Status", description: "", groups: ["Storefront"], supportUrl: null };
    await orgs.create({ name: "Acme", slug: "acme", statusPage, apiKey: KEY });
    await orgs.create({ name: "Other", slug: "other", statusPage, apiKey: OTHER_KEY });

    events = new MemoryEventPublisher();
    synced = [];
    removed = [];
    container = composeContainer({
      logger: testLogger(),
      events,
      scheduler: {
        sync: (monitor: Pick<MonitorDoc, "_id">) => {
          synced.push(monitor._id.toHexString());
          return Promise.resolve();
        },
        remove: (id: string) => {
          removed.push(id);
          return Promise.resolve();
        },
      },
      delivery: { schedule: () => Promise.resolve() },
      dedup: memoryDedupStore(),
      corsOrigins: ["http://localhost:3111"],
      realtimeSecret: SECRET,
      dashboardUrl: "http://localhost:3111",
      readiness: () => Promise.resolve({ mongo: true, redis: true }),
      limits: { publicPerMinute: 5, authFailuresPer15Minutes: 4, maxPerIp: 2, maxPerOrg: 100 },
      statusCacheTtlMs: 60_000,
    });
    app = createApp(container);
  });

  it("rejects requests without a valid API key", async () => {
    await request(app).get("/v1/monitors").expect(401);
    const res = await request(app).get("/v1/monitors").set("authorization", "Bearer nope").expect(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("creates a monitor, applies defaults and registers probe schedulers", async () => {
    const res = await request(app).post("/v1/monitors").set(auth).send(monitorBody).expect(201);
    expect(res.body).toMatchObject({
      key: "checkout",
      status: "pending",
      quorum: 2,
      regions: ["us-east", "eu-west", "ap-southeast"],
      managedBy: "ui",
    });
    expect(synced).toEqual([res.body.id]);
    expect(events.published.some((e) => e.type === "statuspage.changed")).toBe(true);

    await request(app).post("/v1/monitors").set(auth).send(monitorBody).expect(409);
  });

  it("explains validation failures field by field", async () => {
    const res = await request(app)
      .post("/v1/monitors")
      .set(auth)
      .send({ ...monitorBody, quorum: 3, regions: ["us-east"], intervalSeconds: 5 })
      .expect(400);
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toContain("intervalSeconds");
  });

  it("isolates organizations from each other", async () => {
    const created = await request(app).post("/v1/monitors").set(auth).send(monitorBody).expect(201);
    await request(app)
      .get(`/v1/monitors/${created.body.id as string}`)
      .set("authorization", `Bearer ${OTHER_KEY}`)
      .expect(404);
    const list = await request(app)
      .get("/v1/monitors")
      .set("authorization", `Bearer ${OTHER_KEY}`)
      .expect(200);
    expect(list.body.items).toHaveLength(0);
  });

  it("pauses, resumes and deletes monitors", async () => {
    const { body } = await request(app).post("/v1/monitors").set(auth).send(monitorBody).expect(201);
    const id = body.id as string;
    const paused = await request(app).post(`/v1/monitors/${id}/pause`).set(auth).expect(200);
    expect(paused.body.paused).toBe(true);
    await request(app).post(`/v1/monitors/${id}/resume`).set(auth).expect(200);
    await request(app).delete(`/v1/monitors/${id}`).set(auth).expect(204);
    expect(removed).toEqual([id]);
    await request(app).get(`/v1/monitors/${id}`).set(auth).expect(404);
  });

  it("drives the incident state machine and rejects invalid transitions", async () => {
    const created = await request(app)
      .post("/v1/incidents")
      .set(auth)
      .send({ title: "Checkout errors", impact: "major", message: "Customers see errors at checkout." })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.status).toBe("investigating");

    const identified = await request(app)
      .post(`/v1/incidents/${id}/updates`)
      .set(auth)
      .send({ status: "identified", message: "A bad deploy. Rolling back." })
      .expect(201);
    expect(identified.body.updates).toHaveLength(2);

    await request(app)
      .post(`/v1/incidents/${id}/updates`)
      .set(auth)
      .send({ status: "resolved", message: "Fixed." })
      .expect(201);
    const invalid = await request(app)
      .post(`/v1/incidents/${id}/updates`)
      .set(auth)
      .send({ status: "monitoring", message: "Hmm" })
      .expect(422);
    expect(invalid.body.error.code).toBe("invalid_transition");

    const open = await request(app).get("/v1/incidents?status=open").set(auth).expect(200);
    expect(open.body.items).toHaveLength(0);
    const changes = events.published.flatMap((e) => (e.type === "incident.changed" ? [e.change] : []));
    expect(changes).toEqual(["opened", "updated", "resolved"]);
  });

  it("does not skip incidents that share a start time when paginating", async () => {
    const org = await OrgModel.findOne({ slug: "acme" }).lean();
    const startedAt = new Date("2026-05-01T12:00:00Z");
    await IncidentModel.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        orgId: org?._id,
        title: `Simultaneous ${i}`,
        status: "resolved",
        impact: "minor",
        startedAt,
        statusChangedAt: startedAt,
        resolvedAt: startedAt,
      })),
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: request.Response = await request(app)
        .get(`/v1/incidents?limit=2${cursor ? `&cursor=${cursor}` : ""}`)
        .set(auth)
        .expect(200);
      seen.push(...(page.body.items as { id: string }[]).map((i) => i.id));
      cursor = page.body.nextCursor as string | null;
    } while (cursor);
    expect(new Set(seen).size).toBe(5);
  });

  it("paginates incidents with an opaque cursor", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/v1/incidents")
        .set(auth)
        .send({ title: `Incident number ${i}`, message: "Something happened." })
        .expect(201);
    }
    const first = await request(app).get("/v1/incidents?limit=2").set(auth).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await request(app)
      .get(`/v1/incidents?limit=2&cursor=${first.body.nextCursor as string}`)
      .set(auth)
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    await request(app).get("/v1/incidents?cursor=garbage").set(auth).expect(400);
  });

  describe("monitoring as code", () => {
    const config = {
      version: 1,
      statusPage: { title: "Acme Status", groups: ["Storefront"] },
      monitors: [monitorBody],
      slos: [{ key: "checkout-slo", name: "Checkout availability", monitor: "checkout", target: 99.9 }],
      channels: [
        {
          key: "hook",
          name: "Hook",
          target: { type: "webhook", url: "https://hooks.example.com/x", secret: "s3cr3t-s3cr3t-s3cr3t" },
        },
      ],
    };

    it("plans, applies and converges to a no-op plan", async () => {
      const planned = await request(app).post("/v1/config/plan").set(auth).send({ config }).expect(200);
      expect(planned.body.plan.summary).toEqual({ create: 3, update: 0, delete: 0 });
      expect(PlanResponseSchema.safeParse(planned.body).success).toBe(true);
      const secretChange = JSON.stringify(planned.body.plan);
      expect(secretChange).not.toContain("s3cr3t");

      await request(app)
        .post("/v1/config/apply")
        .set(auth)
        .send({ config, planHash: planned.body.planHash })
        .expect(200);
      expect(synced).toHaveLength(1);

      const again = await request(app).post("/v1/config/plan").set(auth).send({ config }).expect(200);
      expect(again.body.plan.summary).toEqual({ create: 0, update: 0, delete: 0 });

      const exported = await request(app).get("/v1/config/export").set(auth).expect(200);
      expect(exported.body.monitors[0].key).toBe("checkout");
      expect(JSON.stringify(exported.body)).not.toContain("s3cr3t");
      expect(exported.body.channels[0].target).toMatchObject({
        url: "${CHANNEL_HOOK_URL}",
        secret: "${CHANNEL_HOOK_SECRET}",
      });
    });

    it("refuses to apply an export whose placeholders were not filled in", async () => {
      await request(app).post("/v1/config/apply").set(auth).send({ config }).expect(200);
      const exported = await request(app).get("/v1/config/export").set(auth).expect(200);
      const res = await request(app)
        .post("/v1/config/apply")
        .set(auth)
        .send({ config: exported.body })
        .expect(400);
      expect(JSON.stringify(res.body.error.details)).toContain("channels.0.target.url");
      const channel = await ChannelModel.findOne({ key: "hook" }).lean();
      expect(channel?.target).toMatchObject({ url: "https://hooks.example.com/x" });
    });

    it("refuses a stale plan", async () => {
      const planned = await request(app).post("/v1/config/plan").set(auth).send({ config }).expect(200);
      await request(app)
        .post("/v1/monitors")
        .set(auth)
        .send({ ...monitorBody, key: "drift", name: "Drift" })
        .expect(201);
      const res = await request(app)
        .post("/v1/config/apply")
        .set(auth)
        .send({ config, planHash: planned.body.planHash })
        .expect(409);
      expect(res.body.error.message).toContain("beacon plan");
    });

    it("prunes only resources that config created", async () => {
      await request(app).post("/v1/config/apply").set(auth).send({ config }).expect(200);
      await request(app)
        .post("/v1/monitors")
        .set(auth)
        .send({ ...monitorBody, key: "manual", name: "Manual" })
        .expect(201);
      const empty = { version: 1 };
      const plan = await request(app)
        .post("/v1/config/plan")
        .set(auth)
        .send({ config: empty, prune: true })
        .expect(200);
      const deleted = (plan.body.plan.changes as { key: string; action: string }[])
        .filter((c) => c.action === "delete")
        .map((c) => c.key)
        .sort();
      expect(deleted).toEqual(["checkout", "checkout-slo", "hook"]);
      await request(app).post("/v1/config/apply").set(auth).send({ config: empty, prune: true }).expect(200);
      const monitors = await request(app).get("/v1/monitors").set(auth).expect(200);
      expect((monitors.body.items as { key: string }[]).map((m) => m.key)).toEqual(["manual"]);
    });

    it("rejects configs with dangling references", async () => {
      const broken = { ...config, slos: [{ key: "x", name: "X", monitor: "nope", target: 99 }] };
      const res = await request(app).post("/v1/config/plan").set(auth).send({ config: broken }).expect(400);
      expect(JSON.stringify(res.body.error.details)).toContain("unknown monitor");
    });
  });

  describe("public status page", () => {
    it("shows only public components and hides private incidents", async () => {
      await request(app).post("/v1/monitors").set(auth).send(monitorBody).expect(201);
      const secret = await request(app)
        .post("/v1/monitors")
        .set(auth)
        .send({ ...monitorBody, key: "internal", name: "Internal admin", public: false })
        .expect(201);
      await request(app)
        .post("/v1/incidents")
        .set(auth)
        .send({
          title: "Internal tooling slow",
          message: "Only staff affected.",
          monitorIds: [secret.body.id],
        })
        .expect(201);

      const res = await request(app).get("/public/status/acme").expect(200);
      expect(res.headers["cache-control"]).toContain("max-age");
      const names = (res.body.groups as { components: { name: string; days: unknown[] }[] }[]).flatMap((g) =>
        g.components.map((c) => c.name),
      );
      expect(names).toEqual(["Checkout"]);
      expect(res.body.groups[0].components[0].days).toHaveLength(90);
      expect(res.body.activeIncidents).toHaveLength(0);
      expect(res.body.overall).toBe("operational");
    });

    it("serves repeat requests from cache until a public event invalidates it", async () => {
      const first = await request(app).get("/public/status/acme").expect(200);
      await request(app).post("/v1/monitors").set(auth).send(monitorBody).expect(201);
      const cached = await request(app).get("/public/status/acme").expect(200);
      expect(cached.body.generatedAt).toBe(first.body.generatedAt);
      expect(cached.body.groups).toHaveLength(0);
      container.statusPage.invalidate("acme");
      const fresh = await request(app).get("/public/status/acme").expect(200);
      expect(fresh.body.groups[0].components[0].name).toBe("Checkout");
    });

    it("renders an SVG badge and 404s unknown pages", async () => {
      const res = await request(app).get("/public/status/acme/badge.svg").buffer(true).expect(200);
      expect(res.headers["content-type"]).toContain("image/svg+xml");
      expect(String(res.body)).toContain("operational");
      await request(app).get("/public/status/missing").expect(404);
    });
  });

  it("sends security headers", async () => {
    const res = await request(app).get("/healthz").expect(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("rate limits anonymous status page traffic and failed authentication", async () => {
    for (let i = 0; i < 5; i++) await request(app).get("/public/status/acme").expect(200);
    const limited = await request(app).get("/public/status/acme").expect(429);
    expect(limited.body.error.code).toBe("rate_limited");

    for (let i = 0; i < 4; i++)
      await request(app).get("/v1/me").set("authorization", "Bearer wrong").expect(401);
    await request(app).get("/v1/me").set("authorization", "Bearer wrong").expect(429);
  });

  it("issues realtime tokens bound to the caller's organization", async () => {
    const me = await request(app).get("/v1/me").set(auth).expect(200);
    const res = await request(app).post("/v1/realtime/token").set(auth).expect(200);
    expect(verifyRealtimeToken(SECRET, res.body.token as string)?.orgId).toBe(me.body.id);
    expect(verifyRealtimeToken("another-secret-entirely", res.body.token as string)).toBeNull();
  });
});
