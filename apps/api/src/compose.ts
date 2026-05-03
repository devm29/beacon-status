import {
  AlertDispatcher,
  IncidentService,
  MaintenanceRepository,
  MonitorRepository,
  OrgRepository,
  SloService,
  type DedupStore,
  type DeliveryScheduler,
  type EventPublisher,
  type Logger,
  type MonitorScheduler,
} from "@beacon/core";
import type { ApiContainer } from "./container.js";
import { memoryStores, type RateLimits, type StoreFactory } from "./http/rate-limit.js";
import { SseHub, type SseLimits } from "./realtime/sse.js";
import { ChannelService } from "./services/channels.js";
import { ConfigService } from "./services/config.js";
import { MaintenanceService } from "./services/maintenance.js";
import { MetricsService } from "./services/metrics.js";
import { MonitorService } from "./services/monitors.js";
import { SloApiService } from "./services/slos.js";
import { StatusPageService } from "./services/status-page.js";

export interface ComposeOptions {
  logger: Logger;
  events: EventPublisher;
  scheduler: Pick<MonitorScheduler, "sync" | "remove">;
  delivery: DeliveryScheduler;
  dedup: DedupStore;
  corsOrigins: string[];
  realtimeSecret: string;
  dashboardUrl: string;
  readiness: () => Promise<Record<string, boolean>>;
  limits?: RateLimits & SseLimits;
  rateLimitStores?: StoreFactory;
  statusCacheTtlMs?: number;
}

const DEFAULT_LIMITS: RateLimits & SseLimits = {
  publicPerMinute: 300,
  authFailuresPer15Minutes: 50,
  maxPerIp: 20,
  maxPerOrg: 5_000,
};

/** Wires repositories and services together; the only place that knows concrete classes. */
export function composeContainer(options: ComposeOptions): ApiContainer {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const orgs = new OrgRepository();
  const monitors = new MonitorRepository();
  const maintenanceRepo = new MaintenanceRepository();
  const alerts = new AlertDispatcher({
    dedup: options.dedup,
    delivery: options.delivery,
    maintenance: maintenanceRepo,
    logger: options.logger.child({ component: "alerts" }),
  });
  const incidents = new IncidentService({
    events: options.events,
    alerts,
    logger: options.logger.child({ component: "incidents" }),
    dashboardUrl: options.dashboardUrl,
  });
  const monitorService = new MonitorService({
    monitors,
    maintenance: maintenanceRepo,
    scheduler: options.scheduler,
    events: options.events,
  });
  const slos = new SloApiService({ slos: new SloService(), monitors });
  const channels = new ChannelService({ delivery: options.delivery, dashboardUrl: options.dashboardUrl });
  return {
    logger: options.logger,
    corsOrigins: options.corsOrigins,
    realtimeSecret: options.realtimeSecret,
    orgs,
    monitors,
    monitorService,
    metrics: new MetricsService(),
    incidents,
    slos,
    channels,
    maintenance: new MaintenanceService({ maintenance: maintenanceRepo, events: options.events }),
    statusPage: new StatusPageService({
      orgs,
      monitors,
      maintenance: maintenanceRepo,
      incidents,
      cacheTtlMs: options.statusCacheTtlMs ?? 10_000,
    }),
    config: new ConfigService({
      orgs,
      monitors,
      monitorService,
      sloService: slos,
      channelService: channels,
      events: options.events,
    }),
    sse: new SseHub(limits),
    limits,
    rateLimitStores: options.rateLimitStores ?? memoryStores,
    readiness: options.readiness,
  };
}
