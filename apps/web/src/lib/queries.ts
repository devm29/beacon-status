import "server-only";
import {
  ChannelDtoSchema,
  CheckResultPageSchema,
  IncidentDtoSchema,
  IncidentPageSchema,
  MaintenanceDtoSchema,
  MetricsDtoSchema,
  MonitorDtoSchema,
  MonitorStatsDtoSchema,
  NotificationDtoSchema,
  OverviewDtoSchema,
  PublicStatusDtoSchema,
  SloDtoSchema,
  SloReportDtoSchema,
  StatusPageSpecSchema,
  type MetricRange,
} from "@beacon/shared";
import { z } from "zod";
import { api, publicApi } from "./api";
import { serverEnv } from "./env";

const itemsOf = <T extends z.ZodType>(schema: T) => z.object({ items: z.array(schema) });

export const MeSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  statusPage: StatusPageSpecSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const getMe = (apiKey?: string) => api("/v1/me", MeSchema, apiKey ? { apiKey } : {});
export const getOverview = () => api("/v1/overview", OverviewDtoSchema);
export const getMonitors = async () => (await api("/v1/monitors", itemsOf(MonitorDtoSchema))).items;
export const getMonitor = (id: string) => api(`/v1/monitors/${encodeURIComponent(id)}`, MonitorDtoSchema);
export const getMonitorStats = (id: string) =>
  api(`/v1/monitors/${encodeURIComponent(id)}/stats`, MonitorStatsDtoSchema);
export const getMonitorMetrics = (id: string, range: MetricRange) =>
  api(`/v1/monitors/${encodeURIComponent(id)}/metrics?range=${range}`, MetricsDtoSchema);

export function getMonitorResults(id: string, cursor?: string) {
  const params = new URLSearchParams({ limit: "25" });
  if (cursor) params.set("cursor", cursor);
  return api(`/v1/monitors/${encodeURIComponent(id)}/results?${params.toString()}`, CheckResultPageSchema);
}

export function getIncidents(
  options: { status?: "open" | "resolved"; cursor?: string; limit?: number } = {},
) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.status) params.set("status", options.status);
  if (options.cursor) params.set("cursor", options.cursor);
  return api(`/v1/incidents?${params.toString()}`, IncidentPageSchema);
}

export const getIncident = (id: string) => api(`/v1/incidents/${encodeURIComponent(id)}`, IncidentDtoSchema);
export const getSlos = async () => (await api("/v1/slos", itemsOf(SloDtoSchema))).items;
export const getSloReport = (id: string) => api(`/v1/slos/${encodeURIComponent(id)}`, SloReportDtoSchema);
export const getChannels = async () => (await api("/v1/channels", itemsOf(ChannelDtoSchema))).items;
export const getNotifications = async (limit = 30) =>
  (await api(`/v1/notifications?limit=${limit}`, itemsOf(NotificationDtoSchema))).items;
export const getMaintenance = async () => (await api("/v1/maintenance", itemsOf(MaintenanceDtoSchema))).items;
// Exported channel credentials are ${PLACEHOLDERS}, which the strict config schema rejects as URLs
// on purpose, so the export is only checked for shape here and rendered back as YAML.
const ExportedConfigSchema = z.looseObject({ version: z.literal(1) });
export const exportConfig = () => api("/v1/config/export", ExportedConfigSchema);

export function statusTag(slug: string): string {
  return `status:${slug}`;
}

/** Cached per slug and invalidated by tag whenever the API sees a public event for the org. */
export function getPublicStatus(slug: string) {
  return publicApi(`/public/status/${encodeURIComponent(slug)}`, PublicStatusDtoSchema, {
    cache: { revalidate: serverEnv.STATUS_REVALIDATE_SECONDS, tags: [statusTag(slug)] },
  });
}
