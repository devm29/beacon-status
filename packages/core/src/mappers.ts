import {
  REGIONS,
  staleAfterMs,
  type IncidentDto,
  type MonitorDto,
  type MonitorSpec,
  type RegionStatusDto,
} from "@beacon/shared";
import type { MonitorDoc } from "./models/index.js";
import type { IncidentWithUpdates } from "./services/incidents.js";

export function monitorSpecOf(doc: MonitorDoc): MonitorSpec {
  return {
    key: doc.key,
    name: doc.name,
    description: doc.description,
    group: doc.group,
    check: doc.check,
    intervalSeconds: doc.intervalSeconds,
    timeoutMs: doc.timeoutMs,
    regions: doc.regions,
    quorum: doc.quorum,
    failThreshold: doc.failThreshold,
    recoverThreshold: doc.recoverThreshold,
    degradedLatencyMs: doc.degradedLatencyMs ?? null,
    public: doc.public,
    paused: doc.paused,
  };
}

export function toMonitorDto(doc: MonitorDoc, options: { inMaintenance: boolean; now?: Date }): MonitorDto {
  const now = options.now ?? new Date();
  const staleCutoff = now.getTime() - staleAfterMs(doc.intervalSeconds);
  const regionStatus: RegionStatusDto[] = [];
  for (const region of REGIONS) {
    const observation = doc.state.regions[region];
    if (!observation || !doc.regions.includes(region)) continue;
    regionStatus.push({
      region,
      status: observation.status,
      latencyMs: Math.round(observation.latencyMs),
      error: observation.error,
      at: new Date(observation.at).toISOString(),
      stale: new Date(observation.at).getTime() < staleCutoff,
    });
  }
  return {
    id: doc._id.toHexString(),
    ...monitorSpecOf(doc),
    managedBy: doc.managedBy,
    status: doc.paused ? "pending" : doc.state.status,
    statusSince: doc.state.since ? new Date(doc.state.since).toISOString() : null,
    flapping: doc.state.flapping,
    lastCheckedAt: doc.state.lastCheckedAt ? new Date(doc.state.lastCheckedAt).toISOString() : null,
    regionStatus,
    inMaintenance: options.inMaintenance,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toIncidentDto(
  incident: IncidentWithUpdates,
  monitors: ReadonlyMap<string, Pick<MonitorDoc, "_id" | "key" | "name">>,
): IncidentDto {
  return {
    id: incident._id.toHexString(),
    title: incident.title,
    status: incident.status,
    impact: incident.impact,
    automated: incident.automated,
    autoResolve: incident.autoResolve,
    monitors: incident.monitorIds.flatMap((id) => {
      const monitor = monitors.get(id.toHexString());
      return monitor ? [{ id: monitor._id.toHexString(), key: monitor.key, name: monitor.name }] : [];
    }),
    startedAt: incident.startedAt.toISOString(),
    statusChangedAt: incident.statusChangedAt.toISOString(),
    resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
    updates: incident.updates.map((u) => ({
      id: u._id.toHexString(),
      status: u.status,
      message: u.message,
      author: u.author,
      automated: u.automated,
      createdAt: u.createdAt.toISOString(),
    })),
  };
}
