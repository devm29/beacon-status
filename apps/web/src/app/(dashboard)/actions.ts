"use server";

import {
  ChannelDtoSchema,
  CreateIncidentInputSchema,
  IncidentDtoSchema,
  IncidentUpdateInputSchema,
  MaintenanceDtoSchema,
  MaintenanceInputSchema,
  MonitorDtoSchema,
  MonitorSpecSchema,
  RealtimeTokenDtoSchema,
  SloDtoSchema,
  SloSpecSchema,
  type CreateIncidentInput,
  type IncidentUpdateInput,
  type MaintenanceInput,
  type MonitorSpecInput,
  type SloSpecInput,
} from "@beacon/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApiError, api } from "@/lib/api";

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors: Record<string, string> };

const DetailSchema = z.array(z.object({ path: z.string(), message: z.string() }));

function fieldErrorsFrom(issues: readonly { path: string; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[issue.path] ??= issue.message;
  return errors;
}

async function attempt<T>(work: () => Promise<T>, paths: string[]): Promise<ActionResult<T>> {
  try {
    const data = await work();
    for (const path of paths) revalidatePath(path, "layout");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        error: "Some fields need your attention.",
        fieldErrors: fieldErrorsFrom(
          error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        ),
      };
    }
    if (error instanceof ApiError) {
      const details = DetailSchema.safeParse(error.details);
      return {
        ok: false,
        error: error.message,
        fieldErrors: details.success ? fieldErrorsFrom(details.data) : {},
      };
    }
    throw error;
  }
}

const Empty = z.unknown();

export async function getRealtimeToken(): Promise<string | null> {
  try {
    const { token } = await api("/v1/realtime/token", RealtimeTokenDtoSchema, { method: "POST" });
    return token;
  } catch {
    return null;
  }
}

export async function createMonitor(input: MonitorSpecInput): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const spec = MonitorSpecSchema.parse(input);
    const monitor = await api("/v1/monitors", MonitorDtoSchema, { method: "POST", body: spec });
    return { id: monitor.id };
  }, ["/"]);
}

export async function setMonitorPaused(id: string, paused: boolean): Promise<ActionResult> {
  return attempt(async () => {
    await api(`/v1/monitors/${encodeURIComponent(id)}/${paused ? "pause" : "resume"}`, MonitorDtoSchema, {
      method: "POST",
    });
    return undefined;
  }, ["/"]);
}

export async function deleteMonitor(id: string): Promise<ActionResult> {
  return attempt(async () => {
    await api(`/v1/monitors/${encodeURIComponent(id)}`, Empty, { method: "DELETE" });
    return undefined;
  }, ["/"]);
}

export async function declareIncident(input: CreateIncidentInput): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const body = CreateIncidentInputSchema.parse(input);
    const incident = await api("/v1/incidents", IncidentDtoSchema, { method: "POST", body });
    return { id: incident.id };
  }, ["/"]);
}

export async function postIncidentUpdate(id: string, input: IncidentUpdateInput): Promise<ActionResult> {
  return attempt(async () => {
    const body = IncidentUpdateInputSchema.parse(input);
    await api(`/v1/incidents/${encodeURIComponent(id)}/updates`, IncidentDtoSchema, { method: "POST", body });
    return undefined;
  }, ["/"]);
}

export async function setChannelEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  return attempt(async () => {
    await api(`/v1/channels/${encodeURIComponent(id)}`, ChannelDtoSchema, {
      method: "PATCH",
      body: { enabled },
    });
    return undefined;
  }, ["/alerts"]);
}

export async function sendTestNotification(id: string): Promise<ActionResult> {
  return attempt(async () => {
    await api(`/v1/channels/${encodeURIComponent(id)}/test`, Empty, { method: "POST" });
    return undefined;
  }, ["/alerts"]);
}

export async function scheduleMaintenance(input: MaintenanceInput): Promise<ActionResult> {
  return attempt(async () => {
    const body = MaintenanceInputSchema.parse(input);
    await api("/v1/maintenance", MaintenanceDtoSchema, { method: "POST", body });
    return undefined;
  }, ["/"]);
}

export async function cancelMaintenance(id: string): Promise<ActionResult> {
  return attempt(async () => {
    await api(`/v1/maintenance/${encodeURIComponent(id)}`, Empty, { method: "DELETE" });
    return undefined;
  }, ["/"]);
}

export async function createSlo(input: SloSpecInput): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const body = SloSpecSchema.parse(input);
    const slo = await api("/v1/slos", SloDtoSchema, { method: "POST", body });
    return { id: slo.id };
  }, ["/slos"]);
}
