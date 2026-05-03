import type {
  DayLevel,
  IncidentImpact,
  IncidentStatus,
  MonitorDto,
  OverallStatus,
  PublicComponent,
} from "@beacon/shared";

export type Tone = "success" | "warning" | "destructive" | "neutral" | "info";

export const TONE_DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted-foreground/40",
  info: "bg-primary",
};

export const TONE_TEXT: Record<Tone, string> = {
  success: "text-success-strong",
  warning: "text-warning-strong",
  destructive: "text-destructive",
  neutral: "text-muted-foreground",
  info: "text-primary",
};

export const TONE_BADGE: Record<Tone, "success" | "warning" | "destructive" | "secondary" | "default"> = {
  success: "success",
  warning: "warning",
  destructive: "destructive",
  neutral: "secondary",
  info: "default",
};

export function monitorTone(monitor: Pick<MonitorDto, "status" | "paused" | "inMaintenance">): {
  tone: Tone;
  label: string;
} {
  if (monitor.paused) return { tone: "neutral", label: "Paused" };
  if (monitor.inMaintenance) return { tone: "info", label: "Maintenance" };
  switch (monitor.status) {
    case "up":
      return { tone: "success", label: "Up" };
    case "degraded":
      return { tone: "warning", label: "Degraded" };
    case "down":
      return { tone: "destructive", label: "Down" };
    case "pending":
      return { tone: "neutral", label: "Pending" };
  }
}

export function checkTone(status: "up" | "degraded" | "down"): Tone {
  return status === "up" ? "success" : status === "degraded" ? "warning" : "destructive";
}

export const INCIDENT_TONE: Record<IncidentStatus, Tone> = {
  investigating: "destructive",
  identified: "warning",
  monitoring: "info",
  resolved: "success",
};

export const IMPACT_LABEL: Record<IncidentImpact, string> = {
  none: "No impact",
  minor: "Minor",
  major: "Major",
  critical: "Critical",
};

export const IMPACT_TONE: Record<IncidentImpact, Tone> = {
  none: "neutral",
  minor: "warning",
  major: "destructive",
  critical: "destructive",
};

export const OVERALL: Record<OverallStatus, { tone: Tone; title: string }> = {
  operational: { tone: "success", title: "All systems operational" },
  degraded: { tone: "warning", title: "Some systems are degraded" },
  partial_outage: { tone: "destructive", title: "Partial outage" },
  major_outage: { tone: "destructive", title: "Major outage" },
  maintenance: { tone: "info", title: "Scheduled maintenance in progress" },
};

export const COMPONENT_STATUS: Record<PublicComponent["status"], { tone: Tone; label: string }> = {
  operational: { tone: "success", label: "Operational" },
  degraded: { tone: "warning", label: "Degraded performance" },
  outage: { tone: "destructive", label: "Outage" },
  maintenance: { tone: "info", label: "Under maintenance" },
  unknown: { tone: "neutral", label: "No data" },
};

export const DAY_LEVEL_CLASS: Record<DayLevel, string> = {
  operational: "bg-success",
  degraded: "bg-warning/70",
  partial: "bg-warning",
  major: "bg-destructive",
  nodata: "bg-muted-foreground/20",
};

export const DAY_LEVEL_LABEL: Record<DayLevel, string> = {
  operational: "No downtime",
  degraded: "Minor disruption",
  partial: "Partial outage",
  major: "Major outage",
  nodata: "No data",
};
