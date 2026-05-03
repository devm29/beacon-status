import { Schema, model, type Types } from "mongoose";

export const GRANULARITIES = ["1m", "1h", "1d"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export interface RollupDoc {
  _id: Types.ObjectId;
  monitorId: Types.ObjectId;
  orgId: Types.ObjectId;
  granularity: Granularity;
  bucket: Date;
  total: number;
  up: number;
  degraded: number;
  down: number;
  latencySum: number;
  latencyCount: number;
  latencyMin: number | null;
  latencyMax: number | null;
  hist: number[];
  expiresAt: Date;
}

export const ROLLUPS_COLLECTION = "rollups";

const rollupSchema = new Schema<RollupDoc>(
  {
    monitorId: { type: Schema.Types.ObjectId, required: true },
    orgId: { type: Schema.Types.ObjectId, required: true },
    granularity: { type: String, enum: GRANULARITIES, required: true },
    bucket: { type: Date, required: true },
    total: { type: Number, required: true },
    up: { type: Number, required: true },
    degraded: { type: Number, required: true },
    down: { type: Number, required: true },
    latencySum: { type: Number, required: true },
    latencyCount: { type: Number, required: true },
    latencyMin: { type: Number, default: null },
    latencyMax: { type: Number, default: null },
    hist: { type: [Number], required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: ROLLUPS_COLLECTION, versionKey: false },
);
rollupSchema.index({ monitorId: 1, granularity: 1, bucket: 1 }, { unique: true });
rollupSchema.index({ granularity: 1, bucket: 1 });
rollupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RollupModel = model<RollupDoc>("Rollup", rollupSchema);
