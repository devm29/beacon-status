import { CHANNEL_TYPE_LABELS, type ChannelDto, type NotificationDto } from "@beacon/shared";
import { BellOff, Globe, Hash, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import { ChannelControls } from "@/components/alerts/channel-controls";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getChannels, getNotifications } from "@/lib/queries";
import type { Tone } from "@/lib/status";

export const metadata = { title: "Alerts" };

const ICONS: Record<ChannelDto["target"]["type"], LucideIcon> = {
  email: Mail,
  slack: Hash,
  discord: MessageCircle,
  webhook: Globe,
};

const DELIVERY: Record<NotificationDto["status"], { tone: Tone; label: string }> = {
  pending: { tone: "info", label: "Pending" },
  sent: { tone: "success", label: "Sent" },
  failed: { tone: "destructive", label: "Failed" },
  suppressed: { tone: "neutral", label: "Suppressed" },
  skipped: { tone: "neutral", label: "Skipped" },
};

function targetSummary(channel: ChannelDto): string {
  const { target } = channel;
  return target.type === "email" ? target.to.join(", ") : target.url;
}

export default async function AlertsPage() {
  const [channels, notifications] = await Promise.all([getChannels(), getNotifications(40)]);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Every alert is deduplicated per channel, held back during maintenance, and can wait out an escalation delay."
      />

      <Card className="gap-0 overflow-hidden p-0">
        <CardHeader className="p-5 pb-3">
          <CardTitle>Channels</CardTitle>
          <CardDescription>
            Email via SMTP, Slack and Discord webhooks, or signed generic webhooks
          </CardDescription>
        </CardHeader>
        {channels.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="No alert channels"
            description="Add channels to beacon.yaml and run beacon apply."
          />
        ) : (
          <ul className="divide-y divide-border/60 border-t border-border/60">
            {channels.map((channel) => {
              const Icon = ICONS[channel.target.type];
              return (
                <li key={channel.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground dark:bg-accent">
                    <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{channel.name}</span>
                      <Badge variant="secondary">{CHANNEL_TYPE_LABELS[channel.target.type]}</Badge>
                      {channel.escalationDelaySeconds > 0 ? (
                        <Badge variant="outline">
                          Waits {Math.round(channel.escalationDelaySeconds / 60)}m before paging
                        </Badge>
                      ) : null}
                      {channel.hasSecret ? <Badge variant="outline">HMAC signed</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">
                      {targetSummary(channel)}
                    </div>
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      {channel.events.join(" · ")}
                      {channel.monitors.length > 0 ? ` · only ${channel.monitors.join(", ")}` : ""}
                      {channel.lastDelivery
                        ? ` · last ${channel.lastDelivery.status} ${formatRelative(channel.lastDelivery.at, now)}`
                        : ""}
                    </div>
                  </div>
                  <ChannelControls id={channel.id} name={channel.name} enabled={channel.enabled} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="gap-0 overflow-hidden p-0">
        <CardHeader className="p-5 pb-3">
          <CardTitle>Delivery log</CardTitle>
          <CardDescription>Why each person was, or wasn’t, notified</CardDescription>
        </CardHeader>
        {notifications.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-muted-foreground">Nothing delivered yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Alert</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notifications.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="tabular-nums">{formatDateTime(n.createdAt)}</TableCell>
                  <TableCell>{n.channel.name}</TableCell>
                  <TableCell className="max-w-96">
                    <div className="truncate">{n.subject}</div>
                    <div className="text-[12px] text-muted-foreground">{n.event}</div>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <StatusBadge {...DELIVERY[n.status]} />
                    {n.reason ? (
                      <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{n.reason}</div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
