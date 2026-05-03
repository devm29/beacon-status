import {
  CheckResultModel,
  SloModel,
  coversMonitor,
  toMonitorDto,
  type CheckResultDoc,
  type EventPublisher,
  type MaintenanceRepository,
  type ManagedBy,
  type MonitorDoc,
  type MonitorRepository,
  type MonitorScheduler,
  type OrgDoc,
} from "@beacon/core";
import { MonitorSpecSchema, type CheckResultDto, type MonitorDto, type MonitorSpec } from "@beacon/shared";
import type { Types } from "mongoose";
import { conflict, notFound } from "../http/errors.js";
import { decodeCursor, encodeCursor } from "../http/params.js";

export class MonitorService {
  constructor(
    private readonly deps: {
      monitors: MonitorRepository;
      maintenance: MaintenanceRepository;
      scheduler: Pick<MonitorScheduler, "sync" | "remove">;
      events: EventPublisher;
    },
  ) {}

  async toDtos(org: OrgDoc, docs: MonitorDoc[], now = new Date()): Promise<MonitorDto[]> {
    const windows = await this.deps.maintenance.active(org._id, now);
    return docs.map((doc) =>
      toMonitorDto(doc, { inMaintenance: windows.some((w) => coversMonitor(w, doc.key)), now }),
    );
  }

  async list(org: OrgDoc): Promise<MonitorDto[]> {
    return this.toDtos(org, await this.deps.monitors.list(org._id));
  }

  async getDoc(org: OrgDoc, id: string): Promise<MonitorDoc> {
    const monitor = await this.deps.monitors.findInOrg(org._id, id);
    if (!monitor) throw notFound("Monitor");
    return monitor;
  }

  async get(org: OrgDoc, id: string): Promise<MonitorDto> {
    const [dto] = await this.toDtos(org, [await this.getDoc(org, id)]);
    if (!dto) throw notFound("Monitor");
    return dto;
  }

  async create(org: OrgDoc, input: unknown, managedBy: ManagedBy = "ui"): Promise<MonitorDto> {
    const spec = MonitorSpecSchema.parse(input);
    const created = await this.createFromSpec(org, spec, managedBy);
    const [dto] = await this.toDtos(org, [created]);
    if (!dto) throw notFound("Monitor");
    return dto;
  }

  async createFromSpec(org: OrgDoc, spec: MonitorSpec, managedBy: ManagedBy): Promise<MonitorDoc> {
    const created = await this.deps.monitors.create(org._id, spec, managedBy);
    await this.deps.scheduler.sync(created);
    await this.changed(org);
    return created;
  }

  async replace(org: OrgDoc, id: string, input: unknown): Promise<MonitorDto> {
    const existing = await this.getDoc(org, id);
    const spec = MonitorSpecSchema.parse(input);
    if (spec.key !== existing.key) throw conflict("A monitor's key cannot change once it is created");
    const updated = await this.replaceFromSpec(org, existing._id, spec, existing.managedBy);
    const [dto] = await this.toDtos(org, [updated]);
    if (!dto) throw notFound("Monitor");
    return dto;
  }

  async replaceFromSpec(
    org: OrgDoc,
    id: Types.ObjectId,
    spec: MonitorSpec,
    managedBy: ManagedBy,
  ): Promise<MonitorDoc> {
    const updated = await this.deps.monitors.replace(org._id, id, spec, managedBy);
    if (!updated) throw notFound("Monitor");
    await this.deps.scheduler.sync(updated);
    await this.changed(org);
    return updated;
  }

  async setPaused(org: OrgDoc, id: string, paused: boolean): Promise<MonitorDto> {
    const existing = await this.getDoc(org, id);
    const updated = await this.deps.monitors.setPaused(org._id, existing._id, paused);
    if (!updated) throw notFound("Monitor");
    await this.deps.scheduler.sync(updated);
    await this.changed(org);
    const [dto] = await this.toDtos(org, [updated]);
    if (!dto) throw notFound("Monitor");
    return dto;
  }

  async delete(org: OrgDoc, id: string): Promise<void> {
    const existing = await this.getDoc(org, id);
    await this.deleteDoc(org, existing);
  }

  async deleteDoc(org: OrgDoc, monitor: MonitorDoc): Promise<void> {
    await this.deps.scheduler.remove(monitor._id.toHexString());
    await SloModel.deleteMany({ orgId: org._id, monitorId: monitor._id }).exec();
    await this.deps.monitors.delete(org._id, monitor._id);
    await this.changed(org);
  }

  async results(
    org: OrgDoc,
    id: string,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<{ items: CheckResultDto[]; nextCursor: string | null }> {
    const monitor = await this.getDoc(org, id);
    const cursor = decodeCursor(page.cursor);
    const filter: Record<string, unknown> = { "meta.monitorId": monitor._id };
    if (cursor) {
      filter.$or = [{ ts: { $lt: cursor.date } }, { ts: cursor.date, _id: { $lt: cursor.id } }];
    }
    const rows = await CheckResultModel.find(filter)
      .sort({ ts: -1, _id: -1 })
      .limit(page.limit + 1)
      .lean<CheckResultDoc[]>()
      .exec();
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items: items.map((r) => ({
        id: r._id.toHexString(),
        region: r.meta.region,
        status: r.status,
        latencyMs: Math.round(r.latencyMs),
        error: r.error,
        statusCode: r.details.statusCode ?? null,
        checkedAt: r.ts.toISOString(),
      })),
      nextCursor: rows.length > page.limit && last ? encodeCursor(last.ts, last._id) : null,
    };
  }

  private async changed(org: OrgDoc): Promise<void> {
    await this.deps.events.publish({
      type: "statuspage.changed",
      orgId: org._id.toHexString(),
      reason: "monitor",
      at: new Date().toISOString(),
    });
  }
}
