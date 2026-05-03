import { Router } from "express";
import type { ApiContainer } from "../container.js";
import { notFound } from "../http/errors.js";
import { componentBadge, overallBadge } from "../services/badge.js";

export function publicRouter(c: ApiContainer): Router {
  const router = Router();

  router.get("/status/:slug", async (req, res) => {
    const status = await c.statusPage.get(req.params.slug);
    res.set("cache-control", "public, max-age=15, stale-while-revalidate=60").json(status);
  });

  router.get("/status/:slug/badge.svg", async (req, res) => {
    const status = await c.statusPage.get(req.params.slug);
    const label =
      typeof req.query.label === "string" && req.query.label.length <= 40 ? req.query.label : "status";
    const componentKey = typeof req.query.component === "string" ? req.query.component : null;
    let svg: string;
    if (componentKey) {
      const component = status.groups.flatMap((g) => g.components).find((comp) => comp.key === componentKey);
      if (!component) throw notFound("Component");
      svg = componentBadge(
        typeof req.query.label === "string" ? label : component.name.toLowerCase(),
        component.status,
      );
    } else {
      svg = overallBadge(label, status.overall);
    }
    res
      .set({
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60",
        "cross-origin-resource-policy": "cross-origin",
      })
      .send(svg);
  });

  router.get("/status/:slug/events", async (req, res) => {
    const org = await c.statusPage.findOrg(req.params.slug);
    const unsubscribe = c.sse.subscribe(org._id.toHexString(), res, req.ip ?? "unknown");
    if (!unsubscribe) {
      res.status(429).json({ error: { code: "rate_limited", message: "Too many open live connections" } });
      return;
    }
    req.on("close", unsubscribe);
  });

  return router;
}
