import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryEventPublisher, OrgModel, OrgRepository, memoryDedupStore } from "@beacon/core";
import { connectTestDatabase, testLogger } from "@beacon/core/testing";
import type { RealtimeEvent } from "@beacon/shared";
import { Server } from "socket.io";
import { io as connectClient } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { composeContainer } from "../compose.js";
import type { ApiContainer } from "../container.js";
import { createFanout } from "./fanout.js";
import { StatusPageRevalidator } from "./revalidator.js";
import { createSocketServer } from "./socket.js";
import { issueRealtimeToken, verifyRealtimeToken } from "./token.js";

const SECRET = "realtime-test-secret-0123";
const logger = testLogger();

function listen(server: HttpServer): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
}

const close = (server: HttpServer) => new Promise<void>((resolve) => server.close(() => resolve()));

const incident = (isPublic: boolean): RealtimeEvent => ({
  type: "incident.changed",
  orgId: "",
  incidentId: "65f000000000000000000001",
  change: "opened",
  title: isPublic ? "Checkout is unavailable" : "Internal admin is unavailable",
  status: "investigating",
  impact: "major",
  public: isPublic,
  at: new Date().toISOString(),
});

describe("realtime tokens", () => {
  it("rejects tampered, foreign and expired tokens", () => {
    const now = Date.parse("2026-06-01T00:00:00Z");
    const { token } = issueRealtimeToken(SECRET, "org-a", 60, now);
    expect(verifyRealtimeToken(SECRET, token, now)?.orgId).toBe("org-a");

    const [, signature] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ orgId: "org-b", exp: now / 1000 + 60 })).toString("base64url")}.${signature ?? ""}`;
    expect(verifyRealtimeToken(SECRET, forged, now)).toBeNull();
    expect(verifyRealtimeToken("some-other-secret-value", token, now)).toBeNull();
    expect(verifyRealtimeToken(SECRET, token, now + 61_000)).toBeNull();
    expect(verifyRealtimeToken(SECRET, "garbage", now)).toBeNull();
  });
});

describe("operator sockets", () => {
  let http: HttpServer;
  let io: Server;
  let base: string;

  beforeAll(async () => {
    http = createServer();
    io = createSocketServer(http, { origins: ["*"], secret: SECRET, logger });
    base = await listen(http);
  });
  afterAll(async () => {
    await io.close();
  });

  const connect = (token: string) =>
    new Promise<string>((resolve) => {
      const socket = connectClient(base, { path: "/realtime", auth: { token }, transports: ["websocket"] });
      socket.on("connect", () => {
        socket.close();
        resolve("connected");
      });
      socket.on("connect_error", (error) => {
        socket.close();
        resolve(error.message);
      });
    });

  it("accepts a valid token and refuses an expired one", async () => {
    expect(await connect(issueRealtimeToken(SECRET, "org-a").token)).toBe("connected");
    const expired = issueRealtimeToken(SECRET, "org-a", 60, Date.now() - 120_000).token;
    expect(await connect(expired)).toBe("unauthorized");
  });
});

describe("public fan-out", () => {
  let drop: () => Promise<void>;
  let container: ApiContainer;
  let http: HttpServer;
  let base: string;
  let orgId: string;
  const open: AbortController[] = [];

  beforeAll(async () => {
    ({ drop } = await connectTestDatabase());
    const statusPage = { title: "Acme Status", description: "", groups: [], supportUrl: null };
    const org = await new OrgRepository().create({
      name: "Acme",
      slug: "acme",
      statusPage,
      apiKey: "bk_realtime_test_key_0123",
    });
    orgId = org._id.toHexString();
    container = composeContainer({
      logger,
      events: new MemoryEventPublisher(),
      scheduler: { sync: () => Promise.resolve(), remove: () => Promise.resolve() },
      delivery: { schedule: () => Promise.resolve() },
      dedup: memoryDedupStore(),
      corsOrigins: [],
      realtimeSecret: SECRET,
      dashboardUrl: "http://localhost:3111",
      readiness: () => Promise.resolve({}),
      limits: { publicPerMinute: 100, authFailuresPer15Minutes: 10, maxPerIp: 2, maxPerOrg: 100 },
    });
    http = createServer(createApp(container));
    base = await listen(http);
  });

  afterEach(() => {
    for (const controller of open.splice(0)) controller.abort();
  });

  afterAll(async () => {
    container.sse.close();
    await close(http);
    await OrgModel.deleteMany({});
    await drop();
  });

  async function subscribe(): Promise<{ status: number; next: () => Promise<string> }> {
    const controller = new AbortController();
    open.push(controller);
    const response = await fetch(`${base}/public/status/acme/events`, { signal: controller.signal });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    return {
      status: response.status,
      next: async () => {
        while (reader && !buffer.includes("\n\n")) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        const end = buffer.indexOf("\n\n");
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return frame;
      },
    };
  }

  it("streams public events, hides private ones and invalidates the cached page", async () => {
    const stream = await subscribe();
    expect(stream.status).toBe(200);
    expect(await stream.next()).toBe("retry: 5000");
    expect(await stream.next()).toMatch(/^event: ready/);

    const invalidated: string[] = [];
    const revalidated: string[] = [];
    const fanout = createFanout({
      io: new Server(),
      sse: container.sse,
      revalidator: {
        schedule: (slug: string) => {
          revalidated.push(slug);
          return Promise.resolve();
        },
      },
      orgs: container.orgs,
      statusPage: { invalidate: (slug) => invalidated.push(slug) },
      logger,
    });

    fanout({ ...incident(false), orgId });
    fanout({ ...incident(true), orgId });
    const frame = await stream.next();
    expect(frame).toContain("event: incident.changed");
    expect(frame).toContain("Checkout is unavailable");
    expect(frame).not.toContain("Internal admin");
    await expect.poll(() => revalidated).toEqual(["acme"]);
    expect(invalidated).toEqual(["acme"]);
  });

  it("caps live connections per client", async () => {
    const first = await subscribe();
    const second = await subscribe();
    const third = await subscribe();
    expect([first.status, second.status, third.status]).toEqual([200, 200, 429]);
  });
});

describe("StatusPageRevalidator", () => {
  it("coalesces bursts into one authenticated request per slug", async () => {
    const received: { secret: string | undefined; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const secret = req.headers["x-revalidate-secret"];
        received.push({ secret: typeof secret === "string" ? secret : undefined, body });
        res.end("{}");
      });
    });
    const base = await listen(server);
    const revalidator = new StatusPageRevalidator({
      url: `${base}/api/revalidate`,
      secret: "revalidate-secret",
      debounceMs: 20,
      logger,
    });
    try {
      await Promise.all([
        revalidator.schedule("acme"),
        revalidator.schedule("acme"),
        revalidator.schedule("acme"),
      ]);
      expect(received).toEqual([
        { secret: "revalidate-secret", body: JSON.stringify({ tags: ["status:acme"] }) },
      ]);
    } finally {
      revalidator.close();
      await close(server);
    }
  });
});
