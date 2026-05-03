import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import { z } from "zod";
import { ChaosStateSchema, HEALTHY, decide, type ChaosState } from "./chaos.js";

export interface SinkEntry {
  id: number;
  sink: string;
  receivedAt: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ChaosAppOptions {
  logger: Logger;
  adminToken?: string | undefined;
  random?: () => number;
}

const MAX_SINK_ENTRIES = 200;

const storefront = (withKeyword: boolean) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Acme Store</title></head>
  <body>
    <h1>Acme Store</h1>
    <p>Hand-picked gear for people who build things.</p>
    ${withKeyword ? '<button type="button">Add to cart</button>' : "<p>Something went wrong rendering this page.</p>"}
  </body>
</html>`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createChaosApp(options: ChaosAppOptions): { app: Express; getState: () => ChaosState } {
  const random = options.random ?? Math.random;
  let state: ChaosState = HEALTHY;
  const sink: SinkEntry[] = [];
  let sinkSeq = 0;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (options.adminToken && req.get("authorization") !== `Bearer ${options.adminToken}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };

  app.get("/admin/state", requireAdmin, (_req, res) => {
    res.json(state);
  });

  app.put("/admin/state", requireAdmin, (req, res) => {
    const parsed = ChaosStateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid chaos state", issues: parsed.error.issues });
      return;
    }
    state = parsed.data;
    options.logger.warn({ state }, "chaos state changed");
    res.json(state);
  });

  app.post("/sink/:name", (req, res) => {
    const name = z
      .string()
      .regex(/^[\w-]{1,40}$/)
      .safeParse(req.params.name);
    if (!name.success) {
      res.status(400).json({ error: "invalid sink name" });
      return;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (
        typeof value === "string" &&
        (key.startsWith("x-") || key === "content-type" || key === "user-agent")
      ) {
        headers[key] = value;
      }
    }
    sinkSeq += 1;
    sink.unshift({
      id: sinkSeq,
      sink: name.data,
      receivedAt: new Date().toISOString(),
      headers,
      body: req.body as unknown,
    });
    sink.length = Math.min(sink.length, MAX_SINK_ENTRIES);
    res.status(204).end();
  });

  app.get("/sink", (req, res) => {
    const filter = typeof req.query.sink === "string" ? req.query.sink : undefined;
    res.json({ items: filter ? sink.filter((e) => e.sink === filter) : sink });
  });

  app.use(async (req, res, next) => {
    const verdict = decide(state, req.get("x-beacon-region") ?? undefined, random);
    if (verdict.kind === "drop") {
      req.socket.destroy();
      return;
    }
    await sleep(verdict.delayMs);
    if (verdict.kind === "error") {
      res.status(verdict.status).json({ error: "upstream unavailable" });
      return;
    }
    res.locals.contentBroken = verdict.kind === "content";
    next();
  });

  app.get("/", (_req, res) => {
    res.type("html").send(storefront(res.locals.contentBroken !== true));
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });

  app.get("/api/checkout", (_req, res) => {
    res.json({ cart: { items: 2, total: 129.0, currency: "USD" }, paymentProvider: "ready" });
  });

  app.get("/api/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({
      query: q,
      results: [
        { id: 1, name: "Field notebook" },
        { id: 2, name: "Carbon pen" },
      ],
    });
  });

  return { app, getState: () => state };
}
