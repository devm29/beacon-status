import {
  ChannelModel,
  IncidentModel,
  NotificationModel,
  toObjectId,
  type ChannelDoc,
  type IncidentDoc,
  type Logger,
  type NotificationDoc,
  type NotificationStatus,
} from "@beacon/core";
import type { ProviderRegistry } from "./providers/registry.js";
import { DeliveryError } from "./providers/types.js";

export type DeliveryResult = { status: NotificationStatus; reason: string | null };

const FOLLOW_UP_EVENTS = new Set(["incident.updated", "incident.resolved"]);

/**
 * Delivers a persisted notification. Escalation and "only follow up if paged" rules are checked
 * here, at send time, because by then the incident may already have resolved.
 */
export class DeliveryService {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async deliver(notificationId: string, options: { finalAttempt: boolean }): Promise<DeliveryResult | null> {
    const id = toObjectId(notificationId);
    if (!id) return null;
    const notification = await NotificationModel.findById(id).lean<NotificationDoc>().exec();
    if (!notification || notification.status !== "pending") return null;

    const channel = await ChannelModel.findById(notification.channelId).lean<ChannelDoc>().exec();
    if (!channel?.enabled) return this.finish(notification, "skipped", "Channel was disabled or deleted");

    if (notification.incidentId) {
      const skip = await this.followUpRule(notification, channel);
      if (skip) return this.finish(notification, "skipped", skip);
    }

    try {
      await this.providers.send(channel.target, {
        id: notification._id.toHexString(),
        event: notification.event,
        subject: notification.subject,
        body: notification.body,
        severity: notification.severity,
        url: notification.url,
        fields: notification.fields,
        createdAt: notification.createdAt,
      });
      return this.finish(notification, "sent", null);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof DeliveryError) || error.retryable;
      if (options.finalAttempt || !retryable) return this.finish(notification, "failed", reason);
      await NotificationModel.updateOne(
        { _id: notification._id },
        { $inc: { attempts: 1 }, $set: { reason } },
      ).exec();
      throw error;
    }
  }

  private async followUpRule(notification: NotificationDoc, channel: ChannelDoc): Promise<string | null> {
    const incident = await IncidentModel.findById(notification.incidentId).lean<IncidentDoc>().exec();
    if (!incident) return "Incident no longer exists";
    if (
      notification.event === "incident.opened" &&
      channel.escalationDelaySeconds > 0 &&
      incident.status === "resolved"
    ) {
      return `Resolved before the ${channel.escalationDelaySeconds}s escalation delay elapsed`;
    }
    if (FOLLOW_UP_EVENTS.has(notification.event)) {
      const paged = await NotificationModel.exists({
        channelId: channel._id,
        incidentId: incident._id,
        event: "incident.opened",
        status: "sent",
      });
      if (!paged) return "This channel was never paged for the incident";
    }
    return null;
  }

  private async finish(
    notification: NotificationDoc,
    status: NotificationStatus,
    reason: string | null,
  ): Promise<DeliveryResult> {
    await NotificationModel.updateOne(
      { _id: notification._id },
      {
        $set: { status, reason, deliveredAt: status === "sent" ? this.now() : null },
        $inc: { attempts: status === "skipped" ? 0 : 1 },
      },
    ).exec();
    this.logger.info(
      { notificationId: notification._id.toHexString(), event: notification.event, status, reason },
      "notification processed",
    );
    return { status, reason };
  }
}
