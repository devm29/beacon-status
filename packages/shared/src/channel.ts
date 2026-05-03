import { z } from "zod";
import { KeySchema } from "./monitor.js";

export const ALERT_EVENTS = [
  "incident.opened",
  "incident.updated",
  "incident.resolved",
  "monitor.degraded",
  "slo.burn",
] as const;
export const AlertEventSchema = z.enum(ALERT_EVENTS);
export type AlertEvent = z.infer<typeof AlertEventSchema>;

const WebhookUrlSchema = z.url({ protocol: /^https?$/ });

export const ChannelTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email"), to: z.array(z.email()).min(1).max(20) }),
  z.object({ type: z.literal("slack"), url: WebhookUrlSchema }),
  z.object({ type: z.literal("discord"), url: WebhookUrlSchema }),
  z.object({
    type: z.literal("webhook"),
    url: WebhookUrlSchema,
    secret: z.string().min(16).max(256).optional(),
    headers: z.record(z.string(), z.string()).default({}),
  }),
]);
export type ChannelTarget = z.infer<typeof ChannelTargetSchema>;
export type ChannelType = ChannelTarget["type"];

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  email: "Email",
  slack: "Slack",
  discord: "Discord",
  webhook: "Webhook",
};

export const ChannelSpecSchema = z.object({
  key: KeySchema,
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  target: ChannelTargetSchema,
  events: z.array(AlertEventSchema).min(1).default(["incident.opened", "incident.resolved", "slo.burn"]),
  /** Monitor keys this channel listens to. Empty means every monitor in the organization. */
  monitors: z.array(KeySchema).default([]),
  /** Wait this long before paging; skipped entirely if the incident resolves in the meantime. */
  escalationDelaySeconds: z.number().int().min(0).max(86_400).default(0),
});
export type ChannelSpec = z.infer<typeof ChannelSpecSchema>;
export type ChannelSpecInput = z.input<typeof ChannelSpecSchema>;

const MASK = "********";

/** For display: hides secrets and header values but keeps enough to recognise the endpoint. */
export function redactTarget(target: ChannelTarget): ChannelTarget {
  switch (target.type) {
    case "email":
      return target;
    case "webhook": {
      const { secret: _secret, headers, ...rest } = target;
      return { ...rest, headers: Object.fromEntries(Object.keys(headers).map((name) => [name, MASK])) };
    }
    case "slack":
    case "discord":
      return { ...target, url: target.url.replace(/(\/[^/]{4})[^/]*$/, `$1${MASK}`) };
  }
}

export function channelEnvName(channelKey: string, field: string): string {
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `CHANNEL_${normalize(channelKey)}_${normalize(field)}`;
}

/**
 * For `beacon export`: every credential-bearing value becomes a `${VAR}` placeholder. The schema
 * rejects an unexpanded placeholder URL, so re-applying an export can never write masked values
 * over real ones.
 */
export function placeholderTarget(channelKey: string, target: ChannelTarget): ChannelTarget {
  const ref = (field: string) => `\${${channelEnvName(channelKey, field)}}`;
  switch (target.type) {
    case "email":
      return target;
    case "slack":
    case "discord":
      return { ...target, url: ref("url") };
    case "webhook":
      return {
        type: "webhook",
        url: ref("url"),
        ...(target.secret ? { secret: ref("secret") } : {}),
        headers: Object.fromEntries(Object.keys(target.headers).map((name) => [name, ref(`header_${name}`)])),
      };
  }
}
