import { INCIDENT_STATUS_LABELS, type IncidentDto } from "@beacon/shared";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDuration } from "@/lib/format";
import { IMPACT_LABEL, IMPACT_TONE, INCIDENT_TONE, TONE_BADGE } from "@/lib/status";

export function IncidentList({ incidents, now }: { incidents: IncidentDto[]; now: Date }) {
  return (
    <ul className="divide-y divide-border/60">
      {incidents.map((incident) => {
        const end = incident.resolvedAt ? new Date(incident.resolvedAt) : now;
        const duration = formatDuration(end.getTime() - new Date(incident.startedAt).getTime());
        const latest = incident.updates[0];
        return (
          <li key={incident.id}>
            <Link
              href={`/incidents/${incident.id}`}
              className="group flex items-center gap-4 px-5 py-3.5 outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{incident.title}</span>
                  <StatusBadge
                    tone={INCIDENT_TONE[incident.status]}
                    label={INCIDENT_STATUS_LABELS[incident.status]}
                    pulse={incident.status === "investigating"}
                  />
                  <Badge variant={TONE_BADGE[IMPACT_TONE[incident.impact]]}>
                    {IMPACT_LABEL[incident.impact]}
                  </Badge>
                  {incident.automated ? <Badge variant="secondary">Automated</Badge> : null}
                </div>
                <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">
                  {latest?.message ?? "No updates yet."}
                </p>
              </div>
              <div className="hidden shrink-0 text-right text-[12px] text-muted-foreground sm:block">
                <div className="tabular-nums">{formatDateTime(incident.startedAt)}</div>
                <div>{incident.resolvedAt ? `Lasted ${duration}` : `Open for ${duration}`}</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
