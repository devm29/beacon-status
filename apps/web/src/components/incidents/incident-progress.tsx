import { INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, type IncidentStatus } from "@beacon/shared";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** The incident state machine as a four-step progress indicator. */
export function IncidentProgress({ status }: { status: IncidentStatus }) {
  const current = INCIDENT_STATUSES.indexOf(status);
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Incident progress">
      {INCIDENT_STATUSES.map((step, index) => {
        const done = index < current || status === "resolved";
        const active = index === current && status !== "resolved";
        return (
          <li key={step} aria-current={active ? "step" : undefined} className="grid gap-2">
            <span
              className={cn(
                "h-1 rounded-full bg-muted",
                (done || active) && "bg-primary",
                active && "animate-pulse motion-reduce:animate-none",
              )}
            />
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[12px]",
                done || active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3 text-primary" strokeWidth={2.5} aria-hidden /> : null}
              {INCIDENT_STATUS_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
