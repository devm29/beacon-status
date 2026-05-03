import { Activity } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MonitorTable } from "@/components/monitors/monitor-table";
import { NewMonitorSheet } from "@/components/monitors/new-monitor-sheet";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getMe, getOverview } from "@/lib/queries";

export const metadata = { title: "Monitors" };

export default async function MonitorsPage() {
  const [me, overview] = await Promise.all([getMe(), getOverview()]);
  const order = [...me.statusPage.groups];
  for (const { monitor } of overview.monitors) if (!order.includes(monitor.group)) order.push(monitor.group);
  const groups = order
    .map((name) => ({ name, rows: overview.monitors.filter((row) => row.monitor.group === name) }))
    .filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader
        title="Monitors"
        description="HTTP, keyword, TCP and certificate checks, each probed from up to three regions."
        actions={<NewMonitorSheet groups={order} />}
      />
      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={Activity}
            title="No monitors yet"
            description="Create one here, or describe them in beacon.yaml and run beacon apply."
            action={<NewMonitorSheet groups={order} />}
          />
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.name} className="gap-0 overflow-hidden p-0">
            <CardHeader className="p-5 pb-3">
              <CardTitle>{group.name}</CardTitle>
            </CardHeader>
            <MonitorTable rows={group.rows} />
          </Card>
        ))
      )}
    </>
  );
}
