import {
  IncidentModel,
  coversMonitor,
  floorTo,
  queryBuckets,
  type IncidentDoc,
  type IncidentService,
  type MaintenanceDoc,
  type MaintenanceRepository,
  type MonitorDoc,
  type MonitorRepository,
  type OrgDoc,
  type OrgRepository,
} from "@beacon/core";
import {
  buildUptimeDays,
  overallUptime,
  type OverallStatus,
  type PublicComponent,
  type PublicIncident,
  type PublicStatusDto,
} from "@beacon/shared";
import { notFound } from "../http/errors.js";
import { maintenanceState } from "./maintenance.js";

const DAY = 86_400_000;
const HISTORY_DAYS = 90;
const RECENT_INCIDENT_DAYS = 14;

type ComponentStatus = PublicComponent["status"];

export function componentStatus(monitor: MonitorDoc, inMaintenance: boolean): ComponentStatus {
  if (inMaintenance) return "maintenance";
  if (monitor.paused) return "unknown";
  switch (monitor.state.status) {
    case "up":
      return "operational";
    case "degraded":
      return "degraded";
    case "down":
      return "outage";
    case "pending":
      return "unknown";
  }
}

export function overallStatus(
  statuses: ComponentStatus[],
  incidents: Pick<IncidentDoc, "impact">[],
): OverallStatus {
  const outages = statuses.filter((s) => s === "outage").length;
  const known = statuses.filter((s) => s !== "unknown").length;
  if (outages > 0 && known > 0 && outages / known >= 0.5) return "major_outage";
  if (incidents.some((i) => i.impact === "critical")) return "major_outage";
  if (outages > 0 || incidents.some((i) => i.impact === "major")) return "partial_outage";
  if (statuses.includes("degraded") || incidents.some((i) => i.impact === "minor")) return "degraded";
  if (statuses.includes("maintenance")) return "maintenance";
  return "operational";
}

/**
 * Assembles everything an anonymous visitor may see for one organization. Builds are memoized
 * per slug for a few seconds and dropped as soon as a public event arrives, so a crowd watching
 * an outage costs one aggregation per change instead of one per visitor; concurrent requests
 * share the build that is already in flight.
 */
export class StatusPageService {
  private readonly cache = new Map<string, { expires: number; value: Promise<PublicStatusDto> }>();

  constructor(
    private readonly deps: {
      orgs: OrgRepository;
      monitors: MonitorRepository;
      maintenance: MaintenanceRepository;
      incidents: IncidentService;
      cacheTtlMs?: number;
    },
  ) {}

  get(slug: string): Promise<PublicStatusDto> {
    const ttl = this.deps.cacheTtlMs ?? 0;
    const now = Date.now();
    const cached = this.cache.get(slug);
    if (cached && cached.expires > now) return cached.value;

    const value = this.build(slug);
    if (ttl > 0) {
      this.cache.set(slug, { expires: now + ttl, value });
      value.catch(() => {
        if (this.cache.get(slug)?.value === value) this.cache.delete(slug);
      });
    }
    return value;
  }

  invalidate(slug: string): void {
    this.cache.delete(slug);
  }

  async findOrg(slug: string): Promise<OrgDoc> {
    const org = await this.deps.orgs.findBySlug(slug);
    if (!org) throw notFound("Status page");
    return org;
  }

  async build(slug: string, now = new Date()): Promise<PublicStatusDto> {
    const org = await this.findOrg(slug);
    const monitors = (await this.deps.monitors.list(org._id)).filter((m) => m.public);
    const publicIds = new Set(monitors.map((m) => m._id.toHexString()));

    const [windows, incidentDocs, daily] = await Promise.all([
      this.deps.maintenance.listRelevant(org._id, now, 1),
      IncidentModel.find({
        orgId: org._id,
        $or: [
          { status: { $ne: "resolved" } },
          { startedAt: { $gte: new Date(now.getTime() - HISTORY_DAYS * DAY) } },
        ],
      })
        .sort({ startedAt: -1 })
        .lean<IncidentDoc[]>()
        .exec(),
      queryBuckets({
        monitorIds: monitors.map((m) => m._id),
        granularity: "1d",
        from: new Date(floorTo(now, "1d").getTime() - (HISTORY_DAYS - 1) * DAY),
        to: now,
      }),
    ]);

    const visibleIncidents = incidentDocs.filter(
      (i) => i.monitorIds.length === 0 || i.monitorIds.some((id) => publicIds.has(id.toHexString())),
    );
    const active = windows.filter((w) => maintenanceState(w, now) === "active");

    const components = new Map<string, PublicComponent>();
    for (const monitor of monitors) {
      const id = monitor._id.toHexString();
      const days = buildUptimeDays(
        daily
          .filter((b) => b.monitorId.equals(monitor._id))
          .map((b) => ({ start: b.bucket, total: b.total, up: b.up, degraded: b.degraded, down: b.down })),
        visibleIncidents
          .filter((i) => i.monitorIds.some((m) => m.equals(monitor._id)))
          .map((i) => ({
            id: i._id.toHexString(),
            title: i.title,
            impact: i.impact,
            startedAt: i.startedAt,
            resolvedAt: i.resolvedAt,
          })),
        HISTORY_DAYS,
        now,
      );
      components.set(id, {
        id,
        key: monitor.key,
        name: monitor.name,
        description: monitor.description,
        status: componentStatus(
          monitor,
          active.some((w) => coversMonitor(w, monitor.key)),
        ),
        uptime90d: overallUptime(days),
        days,
      });
    }

    const groupOrder = [...org.statusPage.groups];
    for (const monitor of monitors) if (!groupOrder.includes(monitor.group)) groupOrder.push(monitor.group);
    const groups = groupOrder
      .map((name) => ({
        name,
        components: monitors
          .filter((m) => m.group === name)
          .flatMap((m) => {
            const component = components.get(m._id.toHexString());
            return component ? [component] : [];
          }),
      }))
      .filter((g) => g.components.length > 0);

    const withUpdates = await this.deps.incidents.withUpdates(
      visibleIncidents.filter(
        (i) => i.status !== "resolved" || i.startedAt.getTime() >= now.getTime() - RECENT_INCIDENT_DAYS * DAY,
      ),
    );
    const toPublic = (i: (typeof withUpdates)[number]): PublicIncident => ({
      id: i._id.toHexString(),
      title: i.title,
      status: i.status,
      impact: i.impact,
      startedAt: i.startedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      components: i.monitorIds.flatMap((id) => {
        const key = id.toHexString();
        const component = publicIds.has(key) ? components.get(key) : undefined;
        return component ? [component.name] : [];
      }),
      updates: i.updates.map((u) => ({
        id: u._id.toHexString(),
        status: u.status,
        message: u.message,
        createdAt: u.createdAt.toISOString(),
      })),
    });
    const activeIncidents = withUpdates.filter((i) => i.status !== "resolved");

    return {
      org: { name: org.name, slug: org.slug },
      page: org.statusPage,
      overall: overallStatus(
        [...components.values()].map((c) => c.status),
        activeIncidents,
      ),
      groups,
      activeIncidents: activeIncidents.map(toPublic),
      recentIncidents: withUpdates.filter((i) => i.status === "resolved").map(toPublic),
      maintenance: windows
        .filter((w) => maintenanceState(w, now) !== "completed")
        .map((w: MaintenanceDoc) => ({
          id: w._id.toHexString(),
          title: w.title,
          description: w.description,
          startsAt: w.startsAt.toISOString(),
          endsAt: w.endsAt.toISOString(),
          state: maintenanceState(w, now),
          components: (w.monitors.length === 0 ? monitors.map((m) => m.key) : w.monitors).flatMap((key) => {
            const monitor = monitors.find((m) => m.key === key);
            return monitor ? [monitor.name] : [];
          }),
        })),
      generatedAt: now.toISOString(),
    };
  }
}
