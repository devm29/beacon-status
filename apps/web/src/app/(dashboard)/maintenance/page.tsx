import type { MaintenanceDto } from "@beacon/shared";
import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CancelMaintenanceButton } from "@/components/maintenance/cancel-button";
import { ScheduleMaintenanceDialog } from "@/components/maintenance/schedule-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration } from "@/lib/format";
import { getMaintenance, getMonitors } from "@/lib/queries";
import type { Tone } from "@/lib/status";

export const metadata = { title: "Maintenance" };

const STATE: Record<MaintenanceDto["state"], { tone: Tone; label: string }> = {
  scheduled: { tone: "info", label: "Scheduled" },
  active: { tone: "warning", label: "In progress" },
  completed: { tone: "neutral", label: "Completed" },
};

export default async function MaintenancePage() {
  const [windows, monitors] = await Promise.all([getMaintenance(), getMonitors()]);
  const names = new Map(monitors.map((m) => [m.key, m.name]));
  const upcoming = windows.filter((w) => w.state !== "completed");
  const past = windows.filter((w) => w.state === "completed").reverse();

  const section = (title: string, items: MaintenanceDto[]) => (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="p-5 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-border/60 border-t border-border/60">
        {items.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{w.title}</span>
                <StatusBadge {...STATE[w.state]} pulse={w.state === "active"} />
              </div>
              <div className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                {formatDateTime(w.startsAt)} ·{" "}
                {formatDuration(new Date(w.endsAt).getTime() - new Date(w.startsAt).getTime())} ·{" "}
                {w.monitors.length === 0
                  ? "All monitors"
                  : w.monitors.map((k) => names.get(k) ?? k).join(", ")}
              </div>
              {w.description ? <p className="mt-1 text-[13px]">{w.description}</p> : null}
            </div>
            {w.state !== "completed" ? <CancelMaintenanceButton id={w.id} title={w.title} /> : null}
          </li>
        ))}
      </ul>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Planned work is announced on the status page and silences incidents and alerts for the monitors involved."
        actions={<ScheduleMaintenanceDialog monitors={monitors.map((m) => ({ key: m.key, name: m.name }))} />}
      />
      {upcoming.length > 0 ? (
        section("Upcoming and in progress", upcoming)
      ) : (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled"
            description="Schedule a window before planned work so nobody gets paged for it."
          />
        </Card>
      )}
      {past.length > 0 ? section("Past 30 days", past) : null}
    </>
  );
}
