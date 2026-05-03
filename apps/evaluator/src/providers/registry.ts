import type { ChannelTarget, ChannelType } from "@beacon/shared";
import type { DeliveryMessage, NotificationProvider, TargetOf } from "./types.js";

type ProviderMap = { [K in ChannelType]: NotificationProvider<TargetOf<K>> };

export class ProviderRegistry {
  constructor(private readonly providers: ProviderMap) {}

  async send(target: ChannelTarget, message: DeliveryMessage): Promise<void> {
    switch (target.type) {
      case "email":
        return this.providers.email.send(target, message);
      case "slack":
        return this.providers.slack.send(target, message);
      case "discord":
        return this.providers.discord.send(target, message);
      case "webhook":
        return this.providers.webhook.send(target, message);
    }
  }
}
