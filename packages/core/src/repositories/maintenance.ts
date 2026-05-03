import type { Types } from "mongoose";
import { MaintenanceModel, type MaintenanceDoc } from "../models/index.js";

export function coversMonitor(window: Pick<MaintenanceDoc, "monitors">, monitorKey: string): boolean {
  return window.monitors.length === 0 || window.monitors.includes(monitorKey);
}

export class MaintenanceRepository {
  async active(orgId: Types.ObjectId, now: Date): Promise<MaintenanceDoc[]> {
    return MaintenanceModel.find({ orgId, startsAt: { $lte: now }, endsAt: { $gt: now } })
      .lean<MaintenanceDoc[]>()
      .exec();
  }

  async isUnderMaintenance(orgId: Types.ObjectId, monitorKey: string, now: Date): Promise<boolean> {
    const windows = await this.active(orgId, now);
    return windows.some((w) => coversMonitor(w, monitorKey));
  }

  async listRelevant(orgId: Types.ObjectId, now: Date, pastDays = 7): Promise<MaintenanceDoc[]> {
    return MaintenanceModel.find({ orgId, endsAt: { $gte: new Date(now.getTime() - pastDays * 86_400_000) } })
      .sort({ startsAt: 1 })
      .lean<MaintenanceDoc[]>()
      .exec();
  }

  async create(
    orgId: Types.ObjectId,
    input: Omit<MaintenanceDoc, "_id" | "orgId" | "createdAt" | "updatedAt">,
  ): Promise<MaintenanceDoc> {
    const created = await MaintenanceModel.create({ ...input, orgId });
    return created.toObject<MaintenanceDoc>();
  }

  async delete(orgId: Types.ObjectId, id: Types.ObjectId): Promise<boolean> {
    const result = await MaintenanceModel.deleteOne({ _id: id, orgId }).exec();
    return result.deletedCount === 1;
  }
}
