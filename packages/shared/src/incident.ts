import { z } from "zod";

export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export const IncidentStatusSchema = z.enum(INCIDENT_STATUSES);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const INCIDENT_IMPACTS = ["none", "minor", "major", "critical"] as const;
export const IncidentImpactSchema = z.enum(INCIDENT_IMPACTS);
export type IncidentImpact = z.infer<typeof IncidentImpactSchema>;

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  investigating: ["investigating", "identified", "monitoring", "resolved"],
  identified: ["investigating", "identified", "monitoring", "resolved"],
  monitoring: ["investigating", "identified", "monitoring", "resolved"],
  // A same-status update on a resolved incident adds a note (a postmortem link, say) without reopening.
  resolved: ["investigating", "resolved"],
};

export function allowedNextStatuses(current: IncidentStatus): readonly IncidentStatus[] {
  return TRANSITIONS[current];
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidIncidentTransitionError extends Error {
  constructor(
    readonly from: IncidentStatus,
    readonly to: IncidentStatus,
  ) {
    super(`An incident cannot move from ${from} to ${to}`);
    this.name = "InvalidIncidentTransitionError";
  }
}

export function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!canTransition(from, to)) throw new InvalidIncidentTransitionError(from, to);
}

export type AutomationSignal =
  | { kind: "monitor_down"; monitorName: string; votes: string }
  | { kind: "monitor_recovered"; monitorName: string }
  | { kind: "stable"; monitorName: string };

export interface AutomationPolicy {
  /** How long a monitor must stay healthy in `monitoring` before the incident resolves itself. */
  resolveAfterMs: number;
  /** A failure this soon after resolution reopens the previous incident instead of opening a new one. */
  reopenWindowMs: number;
}

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  resolveAfterMs: 3 * 60_000,
  reopenWindowMs: 15 * 60_000,
};

export interface IncidentSnapshot {
  status: IncidentStatus;
  autoResolve: boolean;
  statusChangedAt: Date;
  resolvedAt: Date | null;
}

export interface AutomationDecision {
  status: IncidentStatus;
  message: string;
}

/**
 * Decides how an automatically managed incident reacts to a monitor signal. Returns null when the
 * signal should not produce a timeline entry, which keeps repeated failures from spamming updates.
 */
export function decideAutomation(
  incident: IncidentSnapshot,
  signal: AutomationSignal,
  policy: AutomationPolicy,
  now: Date,
): AutomationDecision | null {
  switch (signal.kind) {
    case "monitor_down": {
      if (incident.status === "resolved") {
        const resolvedAt = incident.resolvedAt?.getTime() ?? 0;
        if (now.getTime() - resolvedAt > policy.reopenWindowMs) return null;
        return {
          status: "investigating",
          message: `${signal.monitorName} failed again shortly after recovering (${signal.votes}). Reopening this incident.`,
        };
      }
      if (incident.status === "monitoring") {
        return {
          status: "investigating",
          message: `${signal.monitorName} is failing again (${signal.votes}). We are investigating.`,
        };
      }
      return null;
    }
    case "monitor_recovered": {
      if (incident.status !== "investigating" && incident.status !== "identified") return null;
      return {
        status: "monitoring",
        message: `${signal.monitorName} is responding normally from all regions. We are monitoring the results.`,
      };
    }
    case "stable": {
      if (incident.status !== "monitoring" || !incident.autoResolve) return null;
      if (now.getTime() - incident.statusChangedAt.getTime() < policy.resolveAfterMs) return null;
      return {
        status: "resolved",
        message: `${signal.monitorName} has been healthy for ${Math.round(policy.resolveAfterMs / 60_000)} minutes. This incident has been resolved.`,
      };
    }
  }
}

export function canReopen(incident: IncidentSnapshot, policy: AutomationPolicy, now: Date): boolean {
  return (
    incident.status === "resolved" &&
    incident.resolvedAt !== null &&
    now.getTime() - incident.resolvedAt.getTime() <= policy.reopenWindowMs
  );
}
