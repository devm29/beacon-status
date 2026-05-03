import type { IncidentService, Logger, MonitorRepository, OrgRepository } from "@beacon/core";
import type { RateLimits, StoreFactory } from "./http/rate-limit.js";
import type { SseHub } from "./realtime/sse.js";
import type { ChannelService } from "./services/channels.js";
import type { ConfigService } from "./services/config.js";
import type { MaintenanceService } from "./services/maintenance.js";
import type { MetricsService } from "./services/metrics.js";
import type { MonitorService } from "./services/monitors.js";
import type { SloApiService } from "./services/slos.js";
import type { StatusPageService } from "./services/status-page.js";

export interface ApiContainer {
  logger: Logger;
  corsOrigins: string[];
  realtimeSecret: string;
  orgs: OrgRepository;
  monitors: MonitorRepository;
  monitorService: MonitorService;
  metrics: MetricsService;
  incidents: IncidentService;
  slos: SloApiService;
  channels: ChannelService;
  maintenance: MaintenanceService;
  statusPage: StatusPageService;
  config: ConfigService;
  sse: SseHub;
  limits: RateLimits;
  rateLimitStores: StoreFactory;
  readiness: () => Promise<Record<string, boolean>>;
}
