import { createHmac } from "node:crypto";
import {
  postJson,
  type DeliveryMessage,
  type HttpDeliveryOptions,
  type NotificationProvider,
  type TargetOf,
} from "./types.js";

/** Stripe-style signature: receivers recompute HMAC-SHA256 over `${t}.${body}` and compare. */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

export class WebhookProvider implements NotificationProvider<TargetOf<"webhook">> {
  readonly type = "webhook" as const;
  constructor(
    private readonly http: HttpDeliveryOptions,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async send(target: TargetOf<"webhook">, message: DeliveryMessage): Promise<void> {
    const body = JSON.stringify({
      id: message.id,
      event: message.event,
      subject: message.subject,
      body: message.body,
      severity: message.severity,
      url: message.url,
      fields: message.fields,
      createdAt: message.createdAt.toISOString(),
    });
    const headers: Record<string, string> = {
      ...target.headers,
      "x-beacon-event": message.event,
      "x-beacon-delivery": message.id,
    };
    if (target.secret) {
      headers["x-beacon-signature"] = signPayload(
        target.secret,
        body,
        Math.floor(this.clock().getTime() / 1000),
      );
    }
    await postJson(target.url, null, { ...this.http, headers, body });
  }
}
