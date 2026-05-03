import { Schema, model, type Types } from "mongoose";
import type { ManagedBy } from "./monitor.js";

export interface SloEvaluation {
  at: Date;
  sli: number | null;
  budgetRemaining: number;
  firing: string[];
}

export interface SloDoc {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  monitorId: Types.ObjectId;
  key: string;
  name: string;
  target: number;
  windowDays: 7 | 28 | 30 | 90;
  managedBy: ManagedBy;
  lastEvaluation: SloEvaluation | null;
  createdAt: Date;
  updatedAt: Date;
}

const sloSchema = new Schema<SloDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    monitorId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    target: { type: Number, required: true },
    windowDays: { type: Number, required: true },
    managedBy: { type: String, enum: ["config", "ui"], default: "ui" },
    lastEvaluation: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "slos" },
);
sloSchema.index({ orgId: 1, key: 1 }, { unique: true });
sloSchema.index({ monitorId: 1 });

export const SloModel = model<SloDoc>("Slo", sloSchema);
