import type { CheckDetails, CheckStatus, Region } from "@beacon/shared";
import { Schema, model, type Types } from "mongoose";

export interface CheckResultMeta {
  monitorId: Types.ObjectId;
  orgId: Types.ObjectId;
  region: Region;
}

export interface CheckResultDoc {
  _id: Types.ObjectId;
  ts: Date;
  meta: CheckResultMeta;
  status: CheckStatus;
  latencyMs: number;
  error: string | null;
  details: CheckDetails;
}

export const CHECK_RESULTS_COLLECTION = "check_results";

const DEFAULT_RETENTION_SECONDS = 14 * 86_400;

const checkResultSchema = new Schema<CheckResultDoc>(
  {
    ts: { type: Date, required: true },
    meta: {
      monitorId: { type: Schema.Types.ObjectId, required: true },
      orgId: { type: Schema.Types.ObjectId, required: true },
      region: { type: String, required: true },
    },
    status: { type: String, required: true },
    latencyMs: { type: Number, required: true },
    error: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  {
    collection: CHECK_RESULTS_COLLECTION,
    timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
    expireAfterSeconds: DEFAULT_RETENTION_SECONDS,
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
    minimize: false,
  },
);

export const CheckResultModel = model<CheckResultDoc>("CheckResult", checkResultSchema);
