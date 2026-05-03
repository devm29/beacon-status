"use client";

import {
  INCIDENT_STATUS_LABELS,
  PublicStatusDtoSchema,
  REGIONS,
  REGION_LABELS,
  type PublicIncident,
  type PublicStatusDto,
} from "@beacon/shared";
import { AlertTriangle, CheckCircle2, ChevronRight, Wrench, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { StatusDot } from "@/components/status-dot";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatDateTime, formatDuration, formatPercent, formatTime } from "@/lib/format";
import { COMPONENT_STATUS, IMPACT_LABEL, INCIDENT_TONE, OVERALL, TONE_TEXT, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { UptimeBar } from "./uptime-bar";

const MONITORED_FROM = new Intl.ListFormat("en", { type: "conjunction" }).format(
  REGIONS.map((region) => REGION_LABELS[region].replace(/\s*\(.*\)$/, "")),
);

const HERO_ICON: Record<Tone, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
  info: Wrench,
  neutral: AlertTriangle,
};

const HERO_RING: Record<Tone, string> = {
  success: "bg-success/12",
  warning: "bg-warning/15",
  destructive: "bg-destructive/12",
  info: "bg-primary/12",
  neutral: "bg-muted",
};

/** A snapshot older than this is refreshed when the live connection (re)opens. */
const STALE_SNAPSHOT_MS = 30_000;
/** Spreads refetches out so every open page does not hit the API in the same instant. */
const refetchDelay = () => 750 + Math.floor(Math.random() * 2_000);

/** Keeps an ISR-rendered page current: SSE says something changed, then the page refetches its JSON. */
function useLiveStatus(initial: PublicStatusDto, apiUrl: string): { status: PublicStatusDto; live: boolean } {
  const [status, setStatus] = useState(initial);
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedAt = useRef(Date.parse(initial.generatedAt));

  useEffect(() => {
    const slug = initial.org.slug;
    const base = `${apiUrl}/public/status/${encodeURIComponent(slug)}`;
    const refetch = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void fetch(base, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((json: unknown) => {
            const parsed = PublicStatusDtoSchema.safeParse(json);
            if (!parsed.success) return;
            generatedAt.current = Date.parse(parsed.data.generatedAt);
            setStatus(parsed.data);
          })
          .catch(() => undefined);
      }, refetchDelay());
    };
    const source = new EventSource(`${base}/events`);
    source.addEventListener("ready", () => {
      setLive(true);
      if (Date.now() - generatedAt.current > STALE_SNAPSHOT_MS) refetch();
    });
    source.onerror = () => setLive(false);
    for (const type of ["monitor.status", "incident.changed", "statuspage.changed"])
      source.addEventListener(type, refetch);
    return () => {
      source.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [apiUrl, initial.org.slug]);

  return { status, live };
}

function IncidentCard({ incident, expanded }: { incident: PublicIncident; expanded: boolean }) {
  const tone = INCIDENT_TONE[incident.status];
  const end = incident.resolvedAt ? new Date(incident.resolvedAt) : null;
  return (
    <details
      open={expanded}
      className="group rounded-xl border border-border/60 bg-card shadow-xs [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl p-5 outline-none focus-visible:ring-4 focus-visible:ring-ring">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] leading-[22px] font-semibold tracking-[-0.02em]">{incident.title}</h3>
            <StatusBadge tone={tone} label={INCIDENT_STATUS_LABELS[incident.status]} pulse={!end} />
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {IMPACT_LABEL[incident.impact]} impact
            {incident.components.length > 0 ? ` · ${incident.components.join(", ")}` : ""} ·{" "}
            {formatDateTime(incident.startedAt)}
            {end ? ` · lasted ${formatDuration(end.getTime() - new Date(incident.startedAt).getTime())}` : ""}
          </p>
        </div>
        <ChevronRight
          className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <ol className="grid gap-4 border-t border-border/60 px-5 py-4">
        {incident.updates.map((u) => (
          <li key={u.id} className="grid gap-0.5 sm:grid-cols-[120px_1fr] sm:gap-4">
            <div className="text-[13px]">
              <div className={cn("font-semibold", TONE_TEXT[INCIDENT_TONE[u.status]])}>
                {INCIDENT_STATUS_LABELS[u.status]}
              </div>
              <div className="text-[12px] text-muted-foreground tabular-nums">
                {formatDateTime(u.createdAt)}
              </div>
            </div>
            <p className="text-[15px] leading-[22px]">{u.message}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function StatusPage({ initial, apiUrl }: { initial: PublicStatusDto; apiUrl: string }) {
  const { status, live } = useLiveStatus(initial, apiUrl);
  const overall = OVERALL[status.overall];
  const HeroIcon = HERO_ICON[overall.tone];
  const scheduled = status.maintenance.filter((m) => m.state === "scheduled");
  const activeMaintenance = status.maintenance.filter((m) => m.state === "active");

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="material sticky top-0 z-30 border-b border-border/60 bg-background/72 backdrop-blur-xl backdrop-saturate-[1.8]">
        <div className="mx-auto flex h-13 max-w-[980px] items-center gap-3 px-4 sm:px-6">
          <span className="text-[17px] font-semibold tracking-tight">{status.org.name}</span>
          <span className="hidden text-[13px] text-muted-foreground sm:inline">Status</span>
          <div className="ml-auto flex items-center gap-3">
            {status.page.supportUrl ? (
              <a href={status.page.supportUrl} className="text-[13px] text-primary hover:underline">
                Get support
              </a>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[980px] gap-10 px-4 py-10 sm:px-6 sm:py-14">
        <section className="flex flex-col items-center text-center" aria-live="polite">
          <span className={cn("mb-5 grid size-16 place-items-center rounded-full", HERO_RING[overall.tone])}>
            <HeroIcon className={cn("size-9", TONE_TEXT[overall.tone])} strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="text-[34px] leading-[41px] font-bold tracking-tight sm:text-5xl sm:leading-[1.07] sm:font-semibold">
            {overall.title}
          </h1>
          <p className="mt-3 max-w-xl text-[17px] leading-[25px] text-muted-foreground">
            {status.page.description}
          </p>
          <p className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <StatusDot tone={live ? "success" : "neutral"} pulse={live} />
            {live ? "Live" : "Updated"} · {formatTime(status.generatedAt)} UTC
          </p>
        </section>

        {status.activeIncidents.length > 0 ? (
          <section className="grid gap-3" aria-labelledby="active-heading">
            <h2 id="active-heading" className="text-[22px] leading-7 font-semibold">
              Active incidents
            </h2>
            {status.activeIncidents.map((i) => (
              <IncidentCard key={i.id} incident={i} expanded />
            ))}
          </section>
        ) : null}

        {[...activeMaintenance, ...scheduled].length > 0 ? (
          <section className="grid gap-3" aria-labelledby="maintenance-heading">
            <h2 id="maintenance-heading" className="text-[22px] leading-7 font-semibold">
              Maintenance
            </h2>
            {[...activeMaintenance, ...scheduled].map((m) => (
              <div key={m.id} className="flex gap-3 rounded-xl border border-border/60 bg-card p-5 shadow-xs">
                <Wrench className="mt-0.5 size-[18px] shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{m.title}</span>
                    <StatusBadge
                      tone={m.state === "active" ? "warning" : "info"}
                      label={m.state === "active" ? "In progress" : "Scheduled"}
                    />
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
                    {formatDateTime(m.startsAt)} – {formatTime(m.endsAt)} UTC
                    {m.components.length > 0 ? ` · ${m.components.join(", ")}` : ""}
                  </p>
                  {m.description ? <p className="mt-2 text-[15px] leading-[22px]">{m.description}</p> : null}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section className="grid gap-4" aria-label="Components">
          {status.groups.map((group) => (
            <div
              key={group.name}
              className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-xs"
            >
              <h2 className="px-5 pt-4 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.name}
              </h2>
              <ul className="divide-y divide-border/60">
                {group.components.map((c) => {
                  const s = COMPONENT_STATUS[c.status];
                  return (
                    <li key={c.id} className="grid gap-3 px-5 py-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{c.name}</div>
                          {c.description ? (
                            <div className="text-[13px] text-muted-foreground">{c.description}</div>
                          ) : null}
                        </div>
                        <span className="text-[13px] text-muted-foreground tabular-nums">
                          {formatPercent(c.uptime90d, 2)} uptime
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-[13px] font-medium",
                            TONE_TEXT[s.tone],
                          )}
                        >
                          <StatusDot tone={s.tone} />
                          {s.label}
                        </span>
                      </div>
                      <UptimeBar days={c.days} name={c.name} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section className="grid gap-3" aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-[22px] leading-7 font-semibold">
            Past incidents
          </h2>
          {status.recentIncidents.length === 0 ? (
            <p className="rounded-xl border border-border/60 bg-card p-5 text-[15px] text-muted-foreground shadow-xs">
              No incidents in the last 14 days.
            </p>
          ) : (
            status.recentIncidents.map((i) => <IncidentCard key={i.id} incident={i} expanded={false} />)
          )}
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-[980px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12px] text-muted-foreground sm:px-6">
          <span>Powered by Beacon · monitored from {MONITORED_FROM}</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- live SVG badge from the API */}
          <img
            src={`${apiUrl}/public/status/${status.org.slug}/badge.svg`}
            alt="Current status badge"
            className="h-5 w-auto"
          />
        </div>
      </footer>
    </div>
  );
}
