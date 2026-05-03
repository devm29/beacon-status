import { toIncidentDto, type MonitorDoc } from "@beacon/core";
import {
  CreateIncidentInputSchema,
  IncidentUpdateInputSchema,
  MetricRangeSchema,
  PaginationQuerySchema,
  type OverviewDto,
} from "@beacon/shared";
import { Router } from "express";
import { z } from "zod";
import type { ApiContainer } from "../container.js";
import { apiKeyAuth, orgOf } from "../http/auth.js";
import { badRequest, notFound } from "../http/errors.js";
import { decodeCursor, encodeCursor, idParam, parse } from "../http/params.js";
import { issueRealtimeToken } from "../realtime/token.js";
import { ChannelPatchSchema } from "../services/channels.js";
import { ApplyRequestSchema, PlanRequestSchema } from "../services/config.js";

const IncidentListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(["open", "resolved"]).optional(),
});

export function v1Router(c: ApiContainer): Router {
  const router = Router();
  router.use(apiKeyAuth(c.orgs));

  const monitorsById = async (orgId: MonitorDoc["orgId"]) =>
    new Map((await c.monitors.list(orgId)).map((m) => [m._id.toHexString(), m]));

  router.get("/me", (req, res) => {
    const org = orgOf(req);
    res.json({ id: org._id.toHexString(), name: org.name, slug: org.slug, statusPage: org.statusPage });
  });

  router.post("/realtime/token", (req, res) => {
    const { token, expiresAt } = issueRealtimeToken(c.realtimeSecret, orgOf(req)._id.toHexString());
    res.json({ token, expiresAt: expiresAt.toISOString() });
  });

  router.get("/overview", async (req, res) => {
    const org = orgOf(req);
    const docs = await c.monitors.list(org._id);
    const [dtos, stats, totals, open] = await Promise.all([
      c.monitorService.toDtos(org, docs),
      c.metrics.stats(docs),
      c.metrics.totals(docs.map((d) => d._id)),
      c.incidents.list(org._id, { status: "open", limit: 100 }),
    ]);
    const count = (status: string) => dtos.filter((d) => !d.paused && d.status === status).length;
    const body: OverviewDto = {
      totals: {
        monitors: dtos.length,
        up: count("up"),
        degraded: count("degraded"),
        down: count("down"),
        pending: count("pending"),
        paused: dtos.filter((d) => d.paused).length,
      },
      openIncidents: open.length,
      ...totals,
      monitors: dtos.flatMap((monitor) => {
        const s = stats.get(monitor.id);
        return s ? [{ monitor, stats: s }] : [];
      }),
    };
    res.json(body);
  });

  router.get("/monitors", async (req, res) => {
    res.json({ items: await c.monitorService.list(orgOf(req)) });
  });
  router.post("/monitors", async (req, res) => {
    res.status(201).json(await c.monitorService.create(orgOf(req), req.body));
  });
  router.get("/monitors/:id", async (req, res) => {
    res.json(await c.monitorService.get(orgOf(req), req.params.id));
  });
  router.put("/monitors/:id", async (req, res) => {
    res.json(await c.monitorService.replace(orgOf(req), req.params.id, req.body));
  });
  router.delete("/monitors/:id", async (req, res) => {
    await c.monitorService.delete(orgOf(req), req.params.id);
    res.status(204).end();
  });
  router.post("/monitors/:id/pause", async (req, res) => {
    res.json(await c.monitorService.setPaused(orgOf(req), req.params.id, true));
  });
  router.post("/monitors/:id/resume", async (req, res) => {
    res.json(await c.monitorService.setPaused(orgOf(req), req.params.id, false));
  });
  router.get("/monitors/:id/results", async (req, res) => {
    const page = parse(PaginationQuerySchema, req.query);
    res.json(await c.monitorService.results(orgOf(req), req.params.id, page));
  });
  router.get("/monitors/:id/metrics", async (req, res) => {
    const { range } = parse(z.object({ range: MetricRangeSchema.default("24h") }), req.query);
    const monitor = await c.monitorService.getDoc(orgOf(req), req.params.id);
    res.json(await c.metrics.series(monitor._id, range));
  });
  router.get("/monitors/:id/stats", async (req, res) => {
    const monitor = await c.monitorService.getDoc(orgOf(req), req.params.id);
    const stats = (await c.metrics.stats([monitor])).get(monitor._id.toHexString());
    if (!stats) throw notFound("Monitor stats");
    res.json(stats);
  });

  router.get("/incidents", async (req, res) => {
    const org = orgOf(req);
    const query = parse(IncidentListQuerySchema, req.query);
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) throw badRequest("The pagination cursor is not valid");
    const rows = await c.incidents.list(org._id, {
      status: query.status,
      limit: query.limit + 1,
      before: cursor ?? undefined,
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const monitors = await monitorsById(org._id);
    res.json({
      items: items.map((i) => toIncidentDto(i, monitors)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.startedAt, last._id) : null,
    });
  });
  router.post("/incidents", async (req, res) => {
    const org = orgOf(req);
    const input = parse(CreateIncidentInputSchema, req.body);
    const monitors = await monitorsById(org._id);
    const monitorIds = input.monitorIds.map((id) => {
      const monitor = monitors.get(id);
      if (!monitor) throw badRequest(`Monitor ${id} does not belong to this organization`);
      return monitor._id;
    });
    const created = await c.incidents.createManual(org._id, { ...input, monitorIds }, "Operator");
    const full = await c.incidents.get(org._id, created._id);
    if (!full) throw notFound("Incident");
    res.status(201).json(toIncidentDto(full, monitors));
  });
  router.get("/incidents/:id", async (req, res) => {
    const org = orgOf(req);
    const incident = await c.incidents.get(org._id, idParam(req.params.id, "Incident"));
    if (!incident) throw notFound("Incident");
    res.json(toIncidentDto(incident, await monitorsById(org._id)));
  });
  router.post("/incidents/:id/updates", async (req, res) => {
    const org = orgOf(req);
    const id = idParam(req.params.id, "Incident");
    const input = parse(IncidentUpdateInputSchema, req.body);
    await c.incidents.addManualUpdate(org._id, id, input, "Operator");
    const incident = await c.incidents.get(org._id, id);
    if (!incident) throw notFound("Incident");
    res.status(201).json(toIncidentDto(incident, await monitorsById(org._id)));
  });

  router.get("/slos", async (req, res) => {
    res.json({ items: await c.slos.list(orgOf(req)) });
  });
  router.post("/slos", async (req, res) => {
    res.status(201).json(await c.slos.create(orgOf(req), req.body));
  });
  router.get("/slos/:id", async (req, res) => {
    res.json(await c.slos.report(orgOf(req), req.params.id));
  });
  router.delete("/slos/:id", async (req, res) => {
    await c.slos.delete(orgOf(req), req.params.id);
    res.status(204).end();
  });

  router.get("/channels", async (req, res) => {
    res.json({ items: await c.channels.list(orgOf(req)) });
  });
  router.post("/channels", async (req, res) => {
    res.status(201).json(await c.channels.create(orgOf(req), req.body));
  });
  router.patch("/channels/:id", async (req, res) => {
    const { enabled } = parse(ChannelPatchSchema, req.body);
    res.json(await c.channels.setEnabled(orgOf(req), req.params.id, enabled));
  });
  router.delete("/channels/:id", async (req, res) => {
    await c.channels.delete(orgOf(req), req.params.id);
    res.status(204).end();
  });
  router.post("/channels/:id/test", async (req, res) => {
    res.status(202).json(await c.channels.sendTest(orgOf(req), req.params.id));
  });
  router.get("/notifications", async (req, res) => {
    const { limit } = parse(PaginationQuerySchema, req.query);
    res.json({ items: await c.channels.notifications(orgOf(req), limit), nextCursor: null });
  });

  router.get("/maintenance", async (req, res) => {
    res.json({ items: await c.maintenance.list(orgOf(req)) });
  });
  router.post("/maintenance", async (req, res) => {
    res.status(201).json(await c.maintenance.create(orgOf(req), req.body));
  });
  router.delete("/maintenance/:id", async (req, res) => {
    await c.maintenance.delete(orgOf(req), req.params.id);
    res.status(204).end();
  });

  router.post("/config/plan", async (req, res) => {
    const { config, prune } = parse(PlanRequestSchema, req.body);
    const { plan, planHash } = await c.config.plan(orgOf(req), config, prune);
    res.json({ plan, planHash });
  });
  router.post("/config/apply", async (req, res) => {
    const { config, prune, planHash } = parse(ApplyRequestSchema, req.body);
    res.json(await c.config.apply(orgOf(req), config, { prune, planHash }));
  });
  router.get("/config/export", async (req, res) => {
    res.json(await c.config.export(orgOf(req)));
  });

  return router;
}
