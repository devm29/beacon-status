import {
  postJson,
  type HttpDeliveryOptions,
  type DeliveryMessage,
  type NotificationProvider,
  type TargetOf,
} from "./types.js";

const SEVERITY_PREFIX = {
  critical: ":red_circle:",
  warning: ":large_orange_circle:",
  info: ":large_blue_circle:",
  resolved: ":large_green_circle:",
} as const;

export function slackPayload(message: DeliveryMessage) {
  return {
    text: `${SEVERITY_PREFIX[message.severity]} ${message.subject}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: message.subject.slice(0, 150) } },
      { type: "section", text: { type: "mrkdwn", text: message.body } },
      ...(message.fields.length > 0
        ? [
            {
              type: "section",
              fields: message.fields.map((f) => ({ type: "mrkdwn", text: `*${f.label}*\n${f.value}` })),
            },
          ]
        : []),
      ...(message.url
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: `<${message.url}|Open in Beacon>` }] }]
        : []),
    ],
  };
}

export class SlackProvider implements NotificationProvider<TargetOf<"slack">> {
  readonly type = "slack" as const;
  constructor(private readonly http: HttpDeliveryOptions) {}

  async send(target: TargetOf<"slack">, message: DeliveryMessage): Promise<void> {
    await postJson(target.url, slackPayload(message), this.http);
  }
}
