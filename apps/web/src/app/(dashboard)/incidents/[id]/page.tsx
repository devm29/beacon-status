import { INCIDENT_STATUS_LABELS, type IncidentDto } from "@beacon/shared";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IncidentProgress } from "@/components/incidents/incident-progress";
import { IncidentTimeline } from "@/components/incidents/incident-timeline";
import { IncidentUpdateForm } from "@/components/incidents/incident-update-form";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import { getIncident } from "@/lib/queries";
import { IMPACT_LABEL, IMPACT_TONE, INCIDENT_TONE, TONE_BADGE } from "@/lib/status";

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let incident: IncidentDto;
  try {
    incident = await getIncident(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const end = incident.resolvedAt ? new Date(incident.resolvedAt) : new Date();
  const duration = formatDuration(end.getTime() - new Date(incident.startedAt).getTime());
  const facts = [
    { label: "Started", value: formatDateTime(incident.startedAt) },
    {
      label: incident.resolvedAt ? "Resolved" : "Open for",
      value: incident.resolvedAt ? formatDateTime(incident.resolvedAt) : duration,
    },
    ...(incident.resolvedAt ? [{ label: "Duration", value: duration }] : []),
    { label: "Source", value: incident.automated ? "Automated detection" : "Declared by operator" },
    { label: "Auto-resolve", value: incident.autoResolve ? "On" : "Off" },
  ];

  return (
    <>
      <div className="grid gap-4">
        <Button asChild variant="link" className="h-auto w-fit p-0 text-[13px]">
          <Link href="/incidents">
            <ChevronLeft className="size-4" /> Incidents
          </Link>
        </Button>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] leading-[34px] font-semibold tracking-tight">{incident.title}</h1>
            <StatusBadge
              tone={INCIDENT_TONE[incident.status]}
              label={INCIDENT_STATUS_LABELS[incident.status]}
              pulse={incident.status === "investigating"}
            />
            <Badge variant={TONE_BADGE[IMPACT_TONE[incident.impact]]}>
              {IMPACT_LABEL[incident.impact]} impact
            </Badge>
          </div>
          {incident.monitors.length > 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Affects{" "}
              {incident.monitors.map((m, i) => (
                <span key={m.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/monitors/${m.id}`} className="text-primary hover:underline">
                    {m.name}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </div>

      <Card>
        <IncidentProgress status={incident.status} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>
              Newest first. Entries appear on the public status page unless every affected monitor is private.
            </CardDescription>
          </CardHeader>
          <IncidentTimeline updates={incident.updates} />
        </Card>
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {incident.status === "resolved" ? "Add a note or reopen" : "Post an update"}
              </CardTitle>
            </CardHeader>
            <IncidentUpdateForm
              key={incident.status}
              incidentId={incident.id}
              status={incident.status}
              automated={incident.automated}
              autoResolve={incident.autoResolve}
            />
          </Card>
          <Card className="gap-0 overflow-hidden p-0">
            <dl className="divide-y divide-border/60">
              {facts.map((f) => (
                <div
                  key={f.label}
                  className="flex min-h-11 items-center justify-between gap-4 px-5 text-[13px]"
                >
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="text-right tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
