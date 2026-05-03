import {
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  type IncidentImpact,
  type IncidentStatus,
} from "@beacon/shared";
import { Schema, model, type Types } from "mongoose";

export interface IncidentDoc {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  automated: boolean;
  autoResolve: boolean;
  monitorIds: Types.ObjectId[];
  startedAt: Date;
  statusChangedAt: Date;
  resolvedAt: Date | null;
  /** The opening page was held back because the monitor was flapping; the sweeper sends it later. */
  pageDeferred: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const incidentSchema = new Schema<IncidentDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    status: { type: String, enum: INCIDENT_STATUSES, required: true },
    impact: { type: String, enum: INCIDENT_IMPACTS, required: true },
    automated: { type: Boolean, default: false },
    autoResolve: { type: Boolean, default: true },
    monitorIds: { type: [Schema.Types.ObjectId], default: [] },
    startedAt: { type: Date, required: true },
    statusChangedAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    pageDeferred: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "incidents" },
);
incidentSchema.index({ orgId: 1, startedAt: -1 });
incidentSchema.index({ orgId: 1, status: 1 });
incidentSchema.index({ monitorIds: 1, status: 1, resolvedAt: -1 });
incidentSchema.index({ pageDeferred: 1, status: 1 }, { partialFilterExpression: { pageDeferred: true } });

export const IncidentModel = model<IncidentDoc>("Incident", incidentSchema);

export interface IncidentUpdateDoc {
  _id: Types.ObjectId;
  incidentId: Types.ObjectId;
  orgId: Types.ObjectId;
  status: IncidentStatus;
  message: string;
  author: string;
  automated: boolean;
  createdAt: Date;
}

const incidentUpdateSchema = new Schema<IncidentUpdateDoc>(
  {
    incidentId: { type: Schema.Types.ObjectId, required: true },
    orgId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: INCIDENT_STATUSES, required: true },
    message: { type: String, required: true },
    author: { type: String, required: true },
    automated: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "incident_updates" },
);
incidentUpdateSchema.index({ incidentId: 1, createdAt: 1 });

export const IncidentUpdateModel = model<IncidentUpdateDoc>("IncidentUpdate", incidentUpdateSchema);
