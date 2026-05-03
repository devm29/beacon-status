import type { AlertEvent, ChannelTarget } from "@beacon/shared";
import { Schema, model, type Types } from "mongoose";
import type { ManagedBy } from "./monitor.js";

export interface ChannelDoc {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  key: string;
  name: string;
  enabled: boolean;
  target: ChannelTarget;
  events: AlertEvent[];
  monitors: string[];
  escalationDelaySeconds: number;
  managedBy: ManagedBy;
  createdAt: Date;
  updatedAt: Date;
}

const channelSchema = new Schema<ChannelDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    target: { type: Schema.Types.Mixed, required: true },
    events: { type: [String], required: true },
    monitors: { type: [String], default: [] },
    escalationDelaySeconds: { type: Number, default: 0 },
    managedBy: { type: String, enum: ["config", "ui"], default: "ui" },
  },
  { timestamps: true, collection: "channels", minimize: false },
);
channelSchema.index({ orgId: 1, key: 1 }, { unique: true });

export const ChannelModel = model<ChannelDoc>("Channel", channelSchema);

export const NOTIFICATION_STATUSES = ["pending", "sent", "failed", "suppressed", "skipped"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export type AlertSeverity = "critical" | "warning" | "info" | "resolved";

export interface AlertField {
  label: string;
  value: string;
}

export interface NotificationDoc {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  channelId: Types.ObjectId;
  incidentId: Types.ObjectId | null;
  monitorId: Types.ObjectId | null;
  event: AlertEvent;
  dedupKey: string;
  subject: string;
  body: string;
  severity: AlertSeverity;
  url: string | null;
  fields: AlertField[];
  status: NotificationStatus;
  reason: string | null;
  attempts: number;
  deliverAfter: Date;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    channelId: { type: Schema.Types.ObjectId, required: true },
    incidentId: { type: Schema.Types.ObjectId, default: null },
    monitorId: { type: Schema.Types.ObjectId, default: null },
    event: { type: String, required: true },
    dedupKey: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    severity: { type: String, required: true },
    url: { type: String, default: null },
    fields: { type: [{ label: String, value: String, _id: false }], default: [] },
    status: { type: String, enum: NOTIFICATION_STATUSES, required: true },
    reason: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    deliverAfter: { type: Date, required: true },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "notifications" },
);
notificationSchema.index({ orgId: 1, createdAt: -1 });
notificationSchema.index({ channelId: 1, incidentId: 1, event: 1 });
notificationSchema.index({ orgId: 1, channelId: 1, updatedAt: -1 });
notificationSchema.index(
  { deliverAfter: 1 },
  { partialFilterExpression: { status: "pending" }, name: "pending_by_deliver_after" },
);
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

export const NotificationModel = model<NotificationDoc>("Notification", notificationSchema);

export interface MaintenanceDoc {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  monitors: string[];
  createdAt: Date;
  updatedAt: Date;
}

const maintenanceSchema = new Schema<MaintenanceDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    monitors: { type: [String], default: [] },
  },
  { timestamps: true, collection: "maintenance_windows" },
);
maintenanceSchema.index({ orgId: 1, endsAt: 1, startsAt: 1 });

export const MaintenanceModel = model<MaintenanceDoc>("Maintenance", maintenanceSchema);
