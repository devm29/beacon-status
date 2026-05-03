import { BlockedTargetError, type AlertField, type AlertSeverity, type EgressGuard } from "@beacon/core";
import type { AlertEvent, ChannelTarget, ChannelType } from "@beacon/shared";

export interface DeliveryMessage {
  id: string;
  event: AlertEvent;
  subject: string;
  body: string;
  severity: AlertSeverity;
  url: string | null;
  fields: AlertField[];
  createdAt: Date;
}

export interface NotificationProvider<T extends ChannelTarget = ChannelTarget> {
  readonly type: T["type"];
  send(target: T, message: DeliveryMessage): Promise<void>;
}

export class DeliveryError extends Error {
  override name = "DeliveryError";
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type TargetOf<K extends ChannelType> = Extract<ChannelTarget, { type: K }>;

export const SEVERITY_COLORS: Record<AlertSeverity, number> = {
  critical: 0xff3b30,
  warning: 0xff9500,
  info: 0x0071e3,
  resolved: 0x34c759,
};

export interface HttpDeliveryOptions {
  timeoutMs: number;
  egress: EgressGuard;
}

/**
 * Redirects are not followed: a webhook that answers with one is treated as misconfigured, which
 * also stops a public URL from bouncing deliveries (and their payloads) to internal services.
 */
export async function postJson(
  url: string,
  payload: unknown,
  options: HttpDeliveryOptions & { headers?: Record<string, string>; body?: string },
): Promise<void> {
  let response: Response;
  try {
    await options.egress.checkUrl(url);
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Beacon-Alerts/1.0", ...options.headers },
      body: options.body ?? JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    if (error instanceof BlockedTargetError) throw new DeliveryError(error.message, false);
    throw new DeliveryError(
      `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status >= 300 && response.status < 400) {
    throw new DeliveryError(`Endpoint redirected with HTTP ${response.status}; use the final URL`, false);
  }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new DeliveryError(`Endpoint responded with HTTP ${response.status}`, retryable);
  }
}
