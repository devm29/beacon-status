import { Gauge } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { BudgetBar } from "@/components/slos/budget-bar";
import { NewSloDialog } from "@/components/slos/new-slo-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/format";
import { getMonitors, getSlos } from "@/lib/queries";

export const metadata = { title: "SLOs" };

export default async function SlosPage() {
  const [slos, monitors] = await Promise.all([getSlos(), getMonitors()]);
  return (
    <>
      <PageHeader
        title="Service level objectives"
        description="Error budgets with multi-window, multi-burn-rate alerting from the Google SRE workbook."
        actions={<NewSloDialog monitors={monitors.map((m) => ({ key: m.key, name: m.name }))} />}
      />
      {slos.length === 0 ? (
        <Card>
          <EmptyState
            icon={Gauge}
            title="No SLOs yet"
            description="Set an availability target for a monitor to start tracking its error budget."
          />
        </Card>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {slos.map((slo) => (
            <Link
              key={slo.id}
              href={`/slos/${slo.id}`}
              className="group rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-ring"
            >
              <Card className="h-full gap-4 transition-shadow duration-150 group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[17px] leading-[22px] font-semibold tracking-[-0.02em]">
                      {slo.name}
                    </div>
                    <div className="text-[13px] text-muted-foreground">
                      {slo.monitor.name} · {slo.target}% over {slo.windowDays} days
                    </div>
                  </div>
                  {slo.firing ? (
                    <StatusBadge tone="destructive" label="Burning fast" pulse />
                  ) : slo.budgetRemaining <= 0 ? (
                    <StatusBadge tone="destructive" label="Breached" />
                  ) : (
                    <StatusBadge tone="success" label="Healthy" />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[13px] text-muted-foreground">Availability</div>
                    <div className="text-[22px] leading-7 font-semibold tabular-nums">
                      {formatPercent(slo.sli, 3)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[13px] text-muted-foreground">Budget left</div>
                    <div className="text-[22px] leading-7 font-semibold tabular-nums">
                      {slo.budgetRemaining < 0 ? "Exhausted" : formatPercent(slo.budgetRemaining, 1)}
                    </div>
                  </div>
                </div>
                <BudgetBar remaining={slo.budgetRemaining} label={`${slo.name} error budget remaining`} />
              </Card>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
