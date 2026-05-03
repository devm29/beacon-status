import {
  SloModel,
  type ManagedBy,
  type MonitorDoc,
  type MonitorRepository,
  type OrgDoc,
  type SloDoc,
  type SloService,
} from "@beacon/core";
import { SloSpecSchema, type SloDto, type SloReportDto, type SloSpec } from "@beacon/shared";
import { Types } from "mongoose";
import { badRequest, notFound } from "../http/errors.js";

export class SloApiService {
  constructor(private readonly deps: { slos: SloService; monitors: MonitorRepository }) {}

  private async monitorMap(org: OrgDoc): Promise<Map<string, MonitorDoc>> {
    const monitors = await this.deps.monitors.list(org._id);
    return new Map(monitors.map((m) => [m._id.toHexString(), m]));
  }

  private async toDto(slo: SloDoc, monitor: MonitorDoc, now: Date): Promise<SloDto> {
    const [totals, burn] = await Promise.all([
      this.deps.slos.windowTotals(slo.monitorId, slo.windowDays, now),
      this.deps.slos.burnWindows(slo.monitorId, slo, now),
    ]);
    const allowed = totals.total * (1 - slo.target / 100);
    const bad = totals.total - totals.good;
    return {
      id: slo._id.toHexString(),
      key: slo.key,
      name: slo.name,
      monitor: { id: monitor._id.toHexString(), key: monitor.key, name: monitor.name },
      target: slo.target,
      windowDays: slo.windowDays,
      managedBy: slo.managedBy,
      sli: totals.total > 0 ? totals.good / totals.total : null,
      budgetRemaining: allowed > 0 ? 1 - bad / allowed : bad === 0 ? 1 : -1,
      firing: burn.some((b) => b.firing),
    };
  }

  async list(org: OrgDoc, now = new Date()): Promise<SloDto[]> {
    const [slos, monitors] = await Promise.all([
      SloModel.find({ orgId: org._id }).sort({ name: 1 }).lean<SloDoc[]>().exec(),
      this.monitorMap(org),
    ]);
    return Promise.all(
      slos.flatMap((slo) => {
        const monitor = monitors.get(slo.monitorId.toHexString());
        return monitor ? [this.toDto(slo, monitor, now)] : [];
      }),
    );
  }

  private async getDoc(org: OrgDoc, id: string): Promise<SloDoc> {
    if (!Types.ObjectId.isValid(id)) throw notFound("SLO");
    const slo = await SloModel.findOne({ _id: id, orgId: org._id }).lean<SloDoc>().exec();
    if (!slo) throw notFound("SLO");
    return slo;
  }

  async report(org: OrgDoc, id: string, now = new Date()): Promise<SloReportDto> {
    const slo = await this.getDoc(org, id);
    const monitor = await this.deps.monitors.findById(slo.monitorId);
    if (!monitor) throw notFound("Monitor");
    const report = await this.deps.slos.report(slo, monitor, now);
    const { sli, budgetRemaining, ...rest } = report;
    return {
      slo: {
        id: slo._id.toHexString(),
        key: slo.key,
        name: slo.name,
        monitor: { id: monitor._id.toHexString(), key: monitor.key, name: monitor.name },
        target: slo.target,
        windowDays: slo.windowDays,
        managedBy: slo.managedBy,
        sli,
        budgetRemaining,
        firing: report.burn.some((b) => b.firing),
      },
      ...rest,
    };
  }

  async upsertFromSpec(org: OrgDoc, spec: SloSpec, managedBy: ManagedBy): Promise<SloDoc> {
    const [monitor] = await this.deps.monitors.findByKeys(org._id, [spec.monitor]);
    if (!monitor) throw badRequest(`Monitor "${spec.monitor}" does not exist`);
    const doc = await SloModel.findOneAndUpdate(
      { orgId: org._id, key: spec.key },
      {
        $set: {
          name: spec.name,
          monitorId: monitor._id,
          target: spec.target,
          windowDays: spec.windowDays,
          managedBy,
        },
        $setOnInsert: { lastEvaluation: null },
      },
      { upsert: true, new: true },
    )
      .lean<SloDoc>()
      .exec();
    if (!doc) throw notFound("SLO");
    return doc;
  }

  async create(org: OrgDoc, input: unknown): Promise<SloDto> {
    const spec = SloSpecSchema.parse(input);
    const exists = await SloModel.exists({ orgId: org._id, key: spec.key });
    if (exists) throw badRequest(`An SLO with key "${spec.key}" already exists`);
    const doc = await this.upsertFromSpec(org, spec, "ui");
    const monitor = await this.deps.monitors.findById(doc.monitorId);
    if (!monitor) throw notFound("Monitor");
    return this.toDto(doc, monitor, new Date());
  }

  async delete(org: OrgDoc, id: string): Promise<void> {
    const slo = await this.getDoc(org, id);
    await SloModel.deleteOne({ _id: slo._id }).exec();
  }
}
