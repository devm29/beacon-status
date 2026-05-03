import nodemailer, { type Transporter } from "nodemailer";
import type { Logger } from "@beacon/core";
import { DeliveryError, type DeliveryMessage, type NotificationProvider, type TargetOf } from "./types.js";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export function renderEmail(message: DeliveryMessage): { text: string; html: string } {
  const fields = message.fields.map((f) => `${f.label}: ${f.value}`).join("\n");
  const text = [message.body, fields, message.url ? `Open in Beacon: ${message.url}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const rows = message.fields
    .map(
      (f) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#6e6e73">${escapeHtml(f.label)}</td><td style="padding:4px 0">${escapeHtml(f.value)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;color:#1d1d1f">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:14px;padding:28px">
<h1 style="font-size:20px;font-weight:600;margin:0 0 12px">${escapeHtml(message.subject)}</h1>
<p style="font-size:15px;line-height:22px;margin:0 0 16px">${escapeHtml(message.body)}</p>
<table style="font-size:14px;border-collapse:collapse">${rows}</table>
${message.url ? `<p style="margin:24px 0 0"><a href="${escapeHtml(message.url)}" style="background:#0071e3;color:#fff;text-decoration:none;padding:8px 16px;border-radius:980px;font-size:14px">Open in Beacon</a></p>` : ""}
</div></body></html>`;
  return { text, html };
}

export class EmailProvider implements NotificationProvider<TargetOf<"email">> {
  readonly type = "email" as const;
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(
    options: { smtpUrl: string | undefined; from: string },
    private readonly logger: Logger,
  ) {
    this.from = options.from;
    this.transporter = options.smtpUrl
      ? nodemailer.createTransport(options.smtpUrl)
      : nodemailer.createTransport({ jsonTransport: true });
    if (!options.smtpUrl) logger.warn("SMTP_URL is not set; emails are rendered and logged instead of sent");
  }

  async send(target: TargetOf<"email">, message: DeliveryMessage): Promise<void> {
    const { text, html } = renderEmail(message);
    try {
      const info: unknown = await this.transporter.sendMail({
        from: this.from,
        to: target.to,
        subject: message.subject,
        text,
        html,
      });
      this.logger.debug({ to: target.to, info }, "email handed to transport");
    } catch (error) {
      throw new DeliveryError(
        `SMTP delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }
}
