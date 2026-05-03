import type { SloReportDto } from "@beacon/shared";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BudgetChart } from "@/components/charts/budget-chart";
import { BurnChart } from "@/components/charts/burn-chart";
import { KpiTile } from "@/components/kpi-tile";
import { BudgetBar } from "@/components/slos/budget-bar";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api";
import { formatBurn, formatCount, formatDuration, formatPercent, formatWindow } from "@/lib/format";
import { getSloReport } from "@/lib/queries";

export default async function SloPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let report: SloReportDto;
  try {
    report = await getSloReport(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { slo, totals, burn } = report;
  const allowedDowntime = (1 - slo.target / 100) * slo.windowDays * 86_400_000;

  return (
    <>
      <div className="grid gap-4">
        <Button asChild variant="link" className="h-auto w-fit p-0 text-[13px]">
          <Link href="/slos">
            <ChevronLeft className="size-4" /> SLOs
          </Link>
        </Button>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] leading-[34px] font-semibold tracking-tight">{slo.name}</h1>
            {slo.firing ? (
              <StatusBadge tone="destructive" label="Burn alert firing" pulse />
            ) : (
              <StatusBadge tone="success" label="Within budget" />
            )}
            <Badge variant="secondary">{slo.managedBy === "config" ? "beacon.yaml" : "Dashboard"}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {slo.target}% of probes to{" "}
            <Link href={`/monitors/${slo.monitor.id}`} className="text-primary hover:underline">
              {slo.monitor.name}
            </Link>{" "}
            succeed over a rolling {slo.windowDays}-day window. That allows about{" "}
            {formatDuration(allowedDowntime)} of full downtime.
          </p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Key metrics">
        <KpiTile label="Availability" value={formatPercent(slo.sli, 3)} detail={`Target ${slo.target}%`} />
        <KpiTile
          label="Error budget left"
          value={slo.budgetRemaining < 0 ? "Exhausted" : formatPercent(slo.budgetRemaining, 1)}
          detail={<BudgetBar remaining={slo.budgetRemaining} label="Error budget remaining" />}
        />
        <KpiTile
          label="Failed probes"
          value={formatCount(totals.bad)}
          detail={`of ${formatCount(Math.floor(totals.allowedBad))} allowed`}
        />
        <KpiTile
          label="Total probes"
          value={formatCount(totals.total)}
          detail={`Last ${slo.windowDays} days`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Budget burn-down</CardTitle>
            <CardDescription>Share of the window’s error budget left at the end of each day</CardDescription>
          </CardHeader>
          <BudgetChart points={report.burndown} />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Burn rate</CardTitle>
            <CardDescription>
              Hourly, last 7 days. 1× spends the budget exactly over the window.
            </CardDescription>
          </CardHeader>
          <BurnChart
            points={report.burnSeries}
            thresholds={burn.map((b) => ({ name: b.name, value: b.threshold }))}
          />
        </Card>
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <CardHeader className="p-5 pb-3">
          <CardTitle>Multi-window burn alerts</CardTitle>
          <CardDescription>
            An alert fires only when both the long and the short window exceed the threshold, so it pages fast
            and recovers fast.
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Policy</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead className="text-right">Threshold</TableHead>
              <TableHead className="text-right">Long window</TableHead>
              <TableHead className="text-right">Short window</TableHead>
              <TableHead className="text-right">State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {burn.map((b) => (
              <TableRow key={b.name}>
                <TableCell className="font-medium">{b.name}</TableCell>
                <TableCell>
                  <Badge variant={b.severity === "page" ? "destructive" : "secondary"}>
                    {b.severity === "page" ? "Page" : "Ticket"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatBurn(b.threshold)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBurn(b.longBurn)}{" "}
                  <span className="text-muted-foreground">/ {formatWindow(b.longWindowMinutes)}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBurn(b.shortBurn)}{" "}
                  <span className="text-muted-foreground">/ {formatWindow(b.shortWindowMinutes)}</span>
                </TableCell>
                <TableCell className="text-right">
                  {b.firing ? (
                    <StatusBadge tone="destructive" label="Firing" pulse />
                  ) : (
                    <StatusBadge tone="success" label="OK" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
