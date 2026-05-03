import {
  SEVERITY_COLORS,
  postJson,
  type DeliveryMessage,
  type HttpDeliveryOptions,
  type NotificationProvider,
  type TargetOf,
} from "./types.js";

export function discordPayload(message: DeliveryMessage) {
  return {
    username: "Beacon",
    embeds: [
      {
        title: message.subject.slice(0, 256),
        description: message.body.slice(0, 4000),
        color: SEVERITY_COLORS[message.severity],
        ...(message.url ? { url: message.url } : {}),
        fields: message.fields.slice(0, 25).map((f) => ({ name: f.label, value: f.value, inline: true })),
        timestamp: message.createdAt.toISOString(),
      },
    ],
  };
}

export class DiscordProvider implements NotificationProvider<TargetOf<"discord">> {
  readonly type = "discord" as const;
  constructor(private readonly http: HttpDeliveryOptions) {}

  async send(target: TargetOf<"discord">, message: DeliveryMessage): Promise<void> {
    await postJson(target.url, discordPayload(message), this.http);
  }
}
