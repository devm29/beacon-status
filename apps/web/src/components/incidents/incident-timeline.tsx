import { INCIDENT_STATUS_LABELS, type IncidentUpdateDto } from "@beacon/shared";
import { Bot } from "lucide-react";
import { StatusDot } from "@/components/status-dot";
import { formatDateTime } from "@/lib/format";
import { INCIDENT_TONE } from "@/lib/status";

export function IncidentTimeline({ updates }: { updates: IncidentUpdateDto[] }) {
  return (
    <ol className="relative grid gap-6 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px before:bg-border">
      {updates.map((update) => (
        <li key={update.id} className="relative">
          <StatusDot tone={INCIDENT_TONE[update.status]} className="absolute top-1.5 -left-6" />
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="font-semibold">{INCIDENT_STATUS_LABELS[update.status]}</span>
            <span className="text-muted-foreground tabular-nums">{formatDateTime(update.createdAt)}</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              · {update.automated ? <Bot className="size-3.5" aria-label="Automated" /> : null}
              {update.author}
            </span>
          </div>
          <p className="mt-1 text-[15px] leading-[22px] whitespace-pre-line">{update.message}</p>
        </li>
      ))}
    </ol>
  );
}
