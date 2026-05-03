import {
  ChannelModel,
  NotificationModel,
  type ChannelDoc,
  type DeliveryScheduler,
  type ManagedBy,
  type NotificationDoc,
  type OrgDoc,
} from "@beacon/core";
import {
  ChannelSpecSchema,
  redactTarget,
  type ChannelDto,
  type ChannelSpec,
  type NotificationDto,
} from "@beacon/shared";
import { Types } from "mongoose";
import { z } from "zod";
import { notFound } from "../http/errors.js";

export const ChannelPatchSchema = z.object({ enabled: z.boolean() });

export class ChannelService {
  constructor(private readonly deps: { delivery: DeliveryScheduler; dashboardUrl: string }) {}

  async list(org: OrgDoc): Promise<ChannelDto[]> {
    const channels = await ChannelModel.find({ orgId: org._id })
      .sort({ name: 1 })
      .lean<ChannelDoc[]>()
      .exec();
    // One indexed lookup per channel ({orgId, channelId, updatedAt}) instead of sorting every
    // notification the organization ever received.
    const latest = await Promise.all(
      channels.map((c) =>
        NotificationModel.findOne(
          { orgId: org._id, channelId: c._id, status: { $in: ["sent", "failed", "suppressed", "skipped"] } },
          { status: 1, updatedAt: 1, reason: 1, channelId: 1 },
        )
          .sort({ updatedAt: -1 })
          .lean<Pick<NotificationDoc, "channelId" | "status" | "updatedAt" | "reason">>()
          .exec(),
      ),
    );
    const byChannel = new Map(
      latest.flatMap((l) =>
        l
          ? [[l.channelId.toHexString(), { status: l.status, at: l.updatedAt, reason: l.reason }] as const]
          : [],
      ),
    );
    return channels.map((c) => {
      const last = byChannel.get(c._id.toHexString());
      return {
        id: c._id.toHexString(),
        key: c.key,
        name: c.name,
        enabled: c.enabled,
        target: redactTarget(c.target),
        hasSecret: c.target.type === "webhook" && Boolean(c.target.secret),
        events: c.events,
        monitors: c.monitors,
        escalationDelaySeconds: c.escalationDelaySeconds,
        managedBy: c.managedBy,
        lastDelivery:
          last && last.status !== "pending"
            ? { status: last.status, at: last.at.toISOString(), error: last.reason }
            : null,
      };
    });
  }

  async upsertFromSpec(org: OrgDoc, spec: ChannelSpec, managedBy: ManagedBy): Promise<void> {
    await ChannelModel.updateOne(
      { orgId: org._id, key: spec.key },
      { $set: { ...spec, managedBy } },
      { upsert: true },
    ).exec();
  }

  async create(org: OrgDoc, input: unknown): Promise<ChannelDto> {
    const spec = ChannelSpecSchema.parse(input);
    const created = await ChannelModel.create({ ...spec, orgId: org._id, managedBy: "ui" });
    const dto = (await this.list(org)).find((c) => c.id === created._id.toHexString());
    if (!dto) throw notFound("Channel");
    return dto;
  }

  private async getDoc(org: OrgDoc, id: string): Promise<ChannelDoc> {
    if (!Types.ObjectId.isValid(id)) throw notFound("Channel");
    const channel = await ChannelModel.findOne({ _id: id, orgId: org._id }).lean<ChannelDoc>().exec();
    if (!channel) throw notFound("Channel");
    return channel;
  }

  async setEnabled(org: OrgDoc, id: string, enabled: boolean): Promise<ChannelDto> {
    const channel = await this.getDoc(org, id);
    await ChannelModel.updateOne({ _id: channel._id }, { $set: { enabled } }).exec();
    const dto = (await this.list(org)).find((c) => c.id === id);
    if (!dto) throw notFound("Channel");
    return dto;
  }

  async delete(org: OrgDoc, id: string): Promise<void> {
    const channel = await this.getDoc(org, id);
    await ChannelModel.deleteOne({ _id: channel._id }).exec();
  }

  /** Sends a one-off message through the real delivery pipeline, bypassing dedup and paging rules. */
  async sendTest(org: OrgDoc, id: string): Promise<{ notificationId: string }> {
    const channel = await this.getDoc(org, id);
    const notification = await NotificationModel.create({
      orgId: org._id,
      channelId: channel._id,
      incidentId: null,
      monitorId: null,
      event: "incident.opened",
      dedupKey: `test:${Date.now()}`,
      subject: "[Test] Beacon can reach this channel",
      body: `This is a test notification for "${channel.name}". If you can read it, alerts will arrive here.`,
      severity: "info",
      url: `${this.deps.dashboardUrl}/settings`,
      fields: [{ label: "Channel", value: channel.name }],
      status: "pending",
      reason: null,
      attempts: 0,
      deliverAfter: new Date(),
      deliveredAt: null,
    });
    await this.deps.delivery.schedule(notification._id.toHexString(), 0);
    return { notificationId: notification._id.toHexString() };
  }

  async notifications(org: OrgDoc, limit: number): Promise<NotificationDto[]> {
    const [rows, channels] = await Promise.all([
      NotificationModel.find({ orgId: org._id })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean<NotificationDoc[]>()
        .exec(),
      ChannelModel.find({ orgId: org._id }).lean<ChannelDoc[]>().exec(),
    ]);
    const byId = new Map(channels.map((c) => [c._id.toHexString(), c]));
    return rows.map((n) => {
      const channel = byId.get(n.channelId.toHexString());
      return {
        id: n._id.toHexString(),
        channel: {
          id: n.channelId.toHexString(),
          name: channel?.name ?? "Deleted channel",
          type: channel?.target.type ?? "unknown",
        },
        event: n.event,
        status: n.status,
        reason: n.reason,
        subject: n.subject,
        attempts: n.attempts,
        createdAt: n.createdAt.toISOString(),
      };
    });
  }
}
