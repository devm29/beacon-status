import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { IncidentList } from "@/components/incidents/incident-list";
import { KpiTile } from "@/components/kpi-tile";
import { MonitorTable } from "@/components/monitors/monitor-table";
import { PageHeader } from "@/components/page-header";
import { LiveCheckFeed } from "@/components/realtime/live-check-feed";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount, formatMs, formatPercent } from "@/lib/format";
import { getIncidents, getMe, getOverview } from "@/lib/queries";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const [me, overview, recent] = await Promise.all([getMe(), getOverview(), getIncidents({ limit: 5 })]);
  const { totals } = overview;
  const now = new Date();
  const healthy = totals.up + totals.degraded;
  const monitorNames = Object.fromEntries(overview.monitors.map(({ monitor }) => [monitor.id, monitor.name]));
  const problems = totals.down + totals.degraded;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${me.name} · ${totals.monitors} monitors probed from 3 regions`}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/status/${me.slug}`} target="_blank">
              View status page
            </Link>
          </Button>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key metrics">
        <KpiTile
          label="Monitors healthy"
          value={`${healthy}/${totals.monitors - totals.paused}`}
          detail={
            problems === 0 ? "Everything is responding" : `${totals.down} down · ${totals.degraded} degraded`
          }
        />
        <KpiTile
          label="Open incidents"
          value={overview.openIncidents}
          detail={
            overview.openIncidents === 0 ? (
              "All quiet"
            ) : (
              <Link className="text-primary hover:underline" href="/incidents">
                Review incidents
              </Link>
            )
          }
        />
        <KpiTile
          label="Uptime, 30 days"
          value={formatPercent(overview.uptime30d, 3)}
          detail="Across all monitors"
        />
        <KpiTile
          label="Avg response, 24h"
          value={formatMs(overview.avgLatency24h)}
          detail={`${formatCount(overview.checks24h)} checks`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-0 overflow-hidden p-0 lg:col-span-2">
          <CardHeader className="p-5 pb-3">
            <CardTitle>Monitors</CardTitle>
            <CardDescription>Region chips update live as probes report in.</CardDescription>
          </CardHeader>
          <MonitorTable rows={overview.monitors} compact />
        </Card>
        <Card className="gap-0 overflow-hidden p-0">
          <CardHeader className="p-5 pb-3">
            <CardTitle>Live checks</CardTitle>
            <CardDescription>Streaming from every region over Socket.IO</CardDescription>
          </CardHeader>
          <LiveCheckFeed monitorNames={monitorNames} />
        </Card>
      </section>

      <Card className="gap-0 overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between p-5 pb-3">
          <div className="grid gap-1">
            <CardTitle>Recent incidents</CardTitle>
            <CardDescription>Opened automatically when two of three regions agree</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/incidents">See all</Link>
          </Button>
        </CardHeader>
        {recent.items.length > 0 ? (
          <IncidentList incidents={recent.items} now={now} />
        ) : (
          <div className="flex items-center gap-2 px-5 pb-5 text-[13px] text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden /> No incidents yet.
          </div>
        )}
      </Card>
    </>
  );
}
