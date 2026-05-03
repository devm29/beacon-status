import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEgressGuard, unrestrictedEgress } from "@beacon/core";
import { CheckSchema } from "@beacon/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCheck } from "./index.js";
import { matchesStatus } from "./http.js";
import { classifyCertificate } from "./ssl.js";
import type { ProbeContext } from "./types.js";

const ctx: ProbeContext = {
  region: "eu-west",
  timeoutMs: 1_000,
  degradedLatencyMs: null,
  egress: unrestrictedEgress,
};

const publicResolver = (host: string) =>
  Promise.resolve(host === "public.test" ? ["93.184.215.14"] : ["10.0.0.7"]);

function listen(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

describe("http and keyword checks", () => {
  let server: Server;
  let base: string;
  const seenRegions: string[] = [];

  beforeAll(async () => {
    server = createHttpServer((req, res) => {
      seenRegions.push(String(req.headers["x-beacon-region"]));
      if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 2_000);
        return;
      }
      if (req.url === "/to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      }
      if (req.url === "/hop") {
        res.writeHead(301, { location: "/" });
        res.end();
        return;
      }
      if (req.url === "/missing") {
        res.statusCode = 404;
        res.end("nope");
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end("<html><button>Add to Cart</button></html>");
    });
    base = `http://127.0.0.1:${await listen(server)}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("reports up with the status code and sends the region header", async () => {
    const result = await runCheck(CheckSchema.parse({ type: "http", url: `${base}/` }), ctx);
    expect(result).toMatchObject({ status: "up", error: null, details: { statusCode: 200 } });
    expect(seenRegions).toContain("eu-west");
  });

  it("fails on unexpected status codes", async () => {
    const result = await runCheck(CheckSchema.parse({ type: "http", url: `${base}/missing` }), ctx);
    expect(result).toMatchObject({ status: "down", error: "Unexpected HTTP 404" });
    const allowed = await runCheck(
      CheckSchema.parse({ type: "http", url: `${base}/missing`, expectedStatus: [404] }),
      ctx,
    );
    expect(allowed.status).toBe("up");
  });

  it("matches keywords case-insensitively by default", async () => {
    const found = await runCheck(
      CheckSchema.parse({ type: "keyword", url: base, keyword: "add to cart" }),
      ctx,
    );
    expect(found).toMatchObject({ status: "up", details: { keywordFound: true } });
    const strict = await runCheck(
      CheckSchema.parse({ type: "keyword", url: base, keyword: "add to cart", caseSensitive: true }),
      ctx,
    );
    expect(strict).toMatchObject({ status: "down", details: { keywordFound: false } });
    const absent = await runCheck(
      CheckSchema.parse({ type: "keyword", url: base, keyword: "Error", mode: "absent" }),
      ctx,
    );
    expect(absent.status).toBe("up");
  });

  it("times out slow responses", async () => {
    const result = await runCheck(CheckSchema.parse({ type: "http", url: `${base}/slow` }), {
      ...ctx,
      timeoutMs: 200,
    });
    expect(result).toMatchObject({ status: "down", error: "Timed out after 200ms" });
  });

  it("marks slow but successful responses as degraded", async () => {
    const result = await runCheck(CheckSchema.parse({ type: "http", url: base }), {
      ...ctx,
      degradedLatencyMs: 0,
    });
    expect(result.status).toBe("degraded");
  });

  it("explains refused connections", async () => {
    const closed = createTcpServer();
    const port = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    const result = await runCheck(CheckSchema.parse({ type: "http", url: `http://127.0.0.1:${port}/` }), ctx);
    expect(result).toMatchObject({ status: "down", error: "Connection refused" });
  });

  it("follows redirects hop by hop", async () => {
    const result = await runCheck(CheckSchema.parse({ type: "http", url: `${base}/hop` }), ctx);
    expect(result).toMatchObject({ status: "up", details: { statusCode: 200 } });
    const manual = await runCheck(
      CheckSchema.parse({ type: "http", url: `${base}/hop`, followRedirects: false, expectedStatus: [301] }),
      ctx,
    );
    expect(manual.status).toBe("up");
  });

  it("refuses private targets, including ones reached through a redirect", async () => {
    const guarded = { ...ctx, egress: createEgressGuard({ allowPrivate: false }) };
    const direct = await runCheck(CheckSchema.parse({ type: "http", url: `${base}/` }), guarded);
    expect(direct).toMatchObject({
      status: "down",
      error: "Target resolves to a private or reserved address",
    });

    let hops = 0;
    const firstHopAllowed = {
      ...ctx,
      egress: {
        resolve: (host: string) => Promise.resolve(host),
        checkUrl: async (url: string | URL) => {
          hops += 1;
          if (hops === 1) return "127.0.0.1";
          return createEgressGuard({ allowPrivate: false }).checkUrl(url);
        },
      },
    };
    const redirected = await runCheck(
      CheckSchema.parse({ type: "http", url: `${base}/to-metadata` }),
      firstHopAllowed,
    );
    expect(redirected.error).toBe("Target resolves to a private or reserved address");
    expect(hops).toBe(2);
  });

  it("supports status classes", () => {
    expect(matchesStatus(204, ["2xx"])).toBe(true);
    expect(matchesStatus(301, ["2xx", 301])).toBe(true);
    expect(matchesStatus(500, ["2xx", "4xx"])).toBe(false);
  });
});

describe("tcp checks", () => {
  it("connects to open ports and reports closed ones", async () => {
    const server = createTcpServer((socket) => socket.end());
    const port = await listen(server);
    const open = await runCheck({ type: "tcp", host: "127.0.0.1", port }, ctx);
    expect(open.status).toBe("up");
    server.close();
    const closed = await runCheck({ type: "tcp", host: "127.0.0.1", port: 1 }, ctx);
    expect(closed).toMatchObject({ status: "down", error: "Connection refused" });
  });

  it("will not port-scan internal hosts", async () => {
    const guarded = { ...ctx, egress: createEgressGuard({ allowPrivate: false, resolver: publicResolver }) };
    for (const host of ["127.0.0.1", "169.254.169.254", "redis.internal", "[::1]"]) {
      const result = await runCheck({ type: "tcp", host, port: 6379 }, guarded);
      expect(result).toMatchObject({
        status: "down",
        error: "Target resolves to a private or reserved address",
      });
    }
  });
});

describe("ssl checks", () => {
  it("classifies remaining validity", () => {
    const thresholds = { warnDays: 21, criticalDays: 7 };
    expect(classifyCertificate(90, thresholds).status).toBe("up");
    expect(classifyCertificate(14, thresholds)).toEqual({
      status: "degraded",
      error: "TLS certificate expires in 14 days",
    });
    expect(classifyCertificate(3, thresholds).status).toBe("down");
    expect(classifyCertificate(-1, thresholds)).toEqual({
      status: "down",
      error: "TLS certificate has expired",
    });
  });

  it("reads the certificate and flags untrusted chains", async () => {
    const dir = mkdtempSync(join(tmpdir(), "beacon-ssl-"));
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "10",
          "-subj",
          "/CN=localhost",
          "-keyout",
          join(dir, "key.pem"),
          "-out",
          join(dir, "cert.pem"),
        ],
        { stdio: "ignore" },
      );
    } catch {
      return;
    }
    const server = createHttpsServer(
      { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
      (_req, res) => res.end("ok"),
    );
    const port = await listen(server);
    try {
      const result = await runCheck(CheckSchema.parse({ type: "ssl", host: "127.0.0.1", port }), ctx);
      expect(result.status).toBe("down");
      expect(result.error).toMatch(/not trusted/);
      expect(result.details.certDaysRemaining).toBeGreaterThanOrEqual(9);
    } finally {
      server.close();
    }
  });
});
