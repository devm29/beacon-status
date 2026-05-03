import { initialMonitorState, type MonitorSpec, type MonitorState } from "@beacon/shared";
import { Schema, model, type Types } from "mongoose";

export type ManagedBy = "config" | "ui";

export interface MonitorDoc extends MonitorSpec {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  managedBy: ManagedBy;
  state: MonitorState;
  createdAt: Date;
  updatedAt: Date;
}

const monitorSchema = new Schema<MonitorDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true, ref: "Org" },
    key: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    group: { type: String, required: true },
    check: { type: Schema.Types.Mixed, required: true },
    intervalSeconds: { type: Number, required: true },
    timeoutMs: { type: Number, required: true },
    regions: { type: [String], required: true },
    quorum: { type: Number, required: true },
    failThreshold: { type: Number, required: true },
    recoverThreshold: { type: Number, required: true },
    degradedLatencyMs: { type: Number, default: null },
    public: { type: Boolean, default: true },
    paused: { type: Boolean, default: false },
    managedBy: { type: String, enum: ["config", "ui"], default: "ui" },
    state: { type: Schema.Types.Mixed, default: initialMonitorState },
  },
  { timestamps: true, collection: "monitors", minimize: false },
);
monitorSchema.index({ orgId: 1, key: 1 }, { unique: true });
monitorSchema.index({ orgId: 1, group: 1, name: 1 });

export const MonitorModel = model<MonitorDoc>("Monitor", monitorSchema);
