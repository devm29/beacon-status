import type {
  IncidentImpact,
  IncidentStatus,
  MonitorSpecInput,
  SloSpecInput,
  ChannelSpecInput,
} from "@beacon/shared";
import type { Disruption, LatencyProfile } from "./history.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface DemoMonitor {
  spec: MonitorSpecInput;
  profile: LatencyProfile;
}

export interface DemoIncident {
  monitor: string;
  title: string;
  impact: IncidentImpact;
  automated: boolean;
  /** Offset from "now" when the incident started. */
  startedAgoMs: number;
  durationMs: number;
  disruption: Pick<Disruption, "kind" | "severity" | "extraLatencyMs">;
  timeline: { afterMs: number; status: IncidentStatus; message: string; author: string }[];
}

export interface TcpTarget {
  host: string;
  port: number;
}

export function demoMonitors(chaosUrl: string, database: TcpTarget, cache: TcpTarget): DemoMonitor[] {
  return [
    {
      spec: {
        key: "storefront",
        name: "Storefront",
        description: "acme.shop home page, checked for the Add to cart button",
        group: "Storefront",
        check: { type: "keyword", url: `${chaosUrl}/`, keyword: "Add to cart" },
        intervalSeconds: 30,
        timeoutMs: 8_000,
        degradedLatencyMs: 1_200,
      },
      profile: { baseMs: 140, diurnal: 0.25, jitter: 0.22 },
    },
    {
      spec: {
        key: "checkout-api",
        name: "Checkout API",
        description: "Cart and payment orchestration",
        group: "Storefront",
        check: { type: "http", url: `${chaosUrl}/api/checkout` },
        intervalSeconds: 30,
        timeoutMs: 8_000,
        degradedLatencyMs: 800,
      },
      profile: { baseMs: 210, diurnal: 0.3, jitter: 0.25 },
    },
    {
      spec: {
        key: "search-api",
        name: "Search",
        description: "Product search and autocomplete",
        group: "Storefront",
        check: { type: "http", url: `${chaosUrl}/api/search?q=notebook` },
        intervalSeconds: 60,
        degradedLatencyMs: 1_000,
      },
      profile: { baseMs: 95, diurnal: 0.35, jitter: 0.3 },
    },
    {
      spec: {
        key: "public-api",
        name: "Public API",
        description: "api.acme.dev REST endpoints",
        group: "Core platform",
        check: { type: "http", url: `${chaosUrl}/health` },
        intervalSeconds: 30,
        timeoutMs: 5_000,
      },
      profile: { baseMs: 48, diurnal: 0.2, jitter: 0.2 },
    },
    {
      spec: {
        key: "primary-database",
        name: "Primary database",
        description: "Managed document store, TCP reachability",
        group: "Core platform",
        check: { type: "tcp", host: database.host, port: database.port },
        intervalSeconds: 60,
      },
      profile: { baseMs: 4, diurnal: 0.1, jitter: 0.3 },
    },
    {
      spec: {
        key: "session-cache",
        name: "Session cache",
        description: "Redis cluster backing logins and carts",
        group: "Core platform",
        check: { type: "tcp", host: cache.host, port: cache.port },
        intervalSeconds: 60,
      },
      profile: { baseMs: 3, diurnal: 0.1, jitter: 0.3 },
    },
    {
      spec: {
        key: "edge-certificate",
        name: "Edge TLS certificate",
        description: "Certificate served by the CDN edge",
        group: "Edge & certificates",
        check: { type: "ssl", host: "github.com", warnDays: 21, criticalDays: 7 },
        intervalSeconds: 300,
        timeoutMs: 10_000,
      },
      profile: { baseMs: 120, diurnal: 0.1, jitter: 0.25 },
    },
    {
      spec: {
        key: "docs-site",
        name: "Developer docs",
        description: "docs.acme.dev",
        group: "Edge & certificates",
        check: { type: "http", url: "https://example.com/" },
        intervalSeconds: 120,
        timeoutMs: 10_000,
      },
      profile: { baseMs: 180, diurnal: 0.15, jitter: 0.25 },
    },
  ];
}

export const DEMO_SLOS: SloSpecInput[] = [
  {
    key: "checkout-availability",
    name: "Checkout availability",
    monitor: "checkout-api",
    target: 99.9,
    windowDays: 30,
  },
  {
    key: "storefront-availability",
    name: "Storefront availability",
    monitor: "storefront",
    target: 99.5,
    windowDays: 30,
  },
  {
    key: "public-api-availability",
    name: "Public API availability",
    monitor: "public-api",
    target: 99.95,
    windowDays: 28,
  },
  {
    key: "search-availability",
    name: "Search availability",
    monitor: "search-api",
    target: 99,
    windowDays: 7,
  },
];

export function demoChannels(chaosUrl: string): ChannelSpecInput[] {
  return [
    {
      key: "oncall-email",
      name: "On-call email",
      target: { type: "email", to: ["oncall@acme.dev"] },
      events: ["incident.opened", "incident.updated", "incident.resolved", "slo.burn"],
    },
    {
      key: "incidents-slack",
      name: "#incidents",
      target: { type: "slack", url: `${chaosUrl}/sink/slack` },
      events: ["incident.opened", "incident.updated", "incident.resolved", "monitor.degraded"],
    },
    {
      key: "ops-discord",
      name: "Ops Discord",
      target: { type: "discord", url: `${chaosUrl}/sink/discord` },
      events: ["incident.opened", "incident.resolved"],
      monitors: ["checkout-api", "storefront"],
    },
    {
      key: "pager-bridge",
      name: "Pager bridge",
      target: {
        type: "webhook",
        url: `${chaosUrl}/sink/pager`,
        secret: "whsec_demo_change_me_0001",
        headers: { "x-team": "platform" },
      },
      events: ["incident.opened", "incident.resolved", "slo.burn"],
      escalationDelaySeconds: 120,
    },
  ];
}

export const DEMO_INCIDENTS: DemoIncident[] = [
  {
    monitor: "public-api",
    title: "Public API is unavailable",
    impact: "major",
    automated: true,
    startedAgoMs: 3 * DAY + 5 * HOUR,
    durationMs: 9 * MINUTE,
    disruption: { kind: "down", severity: 0.9 },
    timeline: [
      {
        afterMs: 0,
        status: "investigating",
        message:
          "Automated checks detected that Public API is failing from 3 of 3 regions. us-east: Connection refused. We are investigating.",
        author: "Beacon",
      },
      {
        afterMs: 4 * MINUTE,
        status: "identified",
        message: "A bad config push removed the API pool from the load balancer. Rolling back now.",
        author: "Priya Raman",
      },
      {
        afterMs: 9 * MINUTE,
        status: "monitoring",
        message: "Public API is responding normally from all regions. We are monitoring the results.",
        author: "Beacon",
      },
      {
        afterMs: 12 * MINUTE,
        status: "resolved",
        message: "Public API has been healthy for 3 minutes. This incident has been resolved.",
        author: "Beacon",
      },
    ],
  },
  {
    monitor: "checkout-api",
    title: "Elevated checkout failures",
    impact: "critical",
    automated: false,
    startedAgoMs: 12 * DAY + 2 * HOUR,
    durationMs: 26 * MINUTE,
    disruption: { kind: "down", severity: 0.95 },
    timeline: [
      {
        afterMs: 0,
        status: "investigating",
        message: "Customers are seeing errors when placing orders. We are investigating.",
        author: "Marcus Chen",
      },
      {
        afterMs: 11 * MINUTE,
        status: "identified",
        message:
          "Our payment provider is rejecting requests after a certificate rotation on their side. We are failing over to the secondary provider.",
        author: "Marcus Chen",
      },
      {
        afterMs: 26 * MINUTE,
        status: "monitoring",
        message: "Orders are going through on the secondary provider. We are watching error rates closely.",
        author: "Marcus Chen",
      },
      {
        afterMs: 58 * MINUTE,
        status: "resolved",
        message: "Checkout has been stable for 30 minutes. A full post-incident review will follow.",
        author: "Marcus Chen",
      },
    ],
  },
  {
    monitor: "storefront",
    title: "Slow page loads on the storefront",
    impact: "minor",
    automated: false,
    startedAgoMs: 27 * DAY + 7 * HOUR,
    durationMs: 2 * HOUR + 10 * MINUTE,
    disruption: { kind: "slow", severity: 0.7, extraLatencyMs: 1_800 },
    timeline: [
      {
        afterMs: 0,
        status: "investigating",
        message: "Pages are loading slower than usual. Checkout is unaffected.",
        author: "Sofia Alvarez",
      },
      {
        afterMs: 40 * MINUTE,
        status: "identified",
        message:
          "A cache eviction storm after the catalog import is sending traffic to origin. Warming caches now.",
        author: "Sofia Alvarez",
      },
      {
        afterMs: 2 * HOUR + 10 * MINUTE,
        status: "resolved",
        message: "Cache hit ratio is back above 97% and page loads are normal.",
        author: "Sofia Alvarez",
      },
    ],
  },
  {
    monitor: "search-api",
    title: "Search is unavailable",
    impact: "major",
    automated: true,
    startedAgoMs: 51 * DAY + 3 * HOUR,
    durationMs: 47 * MINUTE,
    disruption: { kind: "down", severity: 0.85 },
    timeline: [
      {
        afterMs: 0,
        status: "investigating",
        message:
          "Automated checks detected that Search is failing from 2 of 3 regions. eu-west: HTTP 503. We are investigating.",
        author: "Beacon",
      },
      {
        afterMs: 15 * MINUTE,
        status: "identified",
        message:
          "The search cluster lost quorum after a node replacement. Restoring from the latest snapshot.",
        author: "Priya Raman",
      },
      {
        afterMs: 47 * MINUTE,
        status: "monitoring",
        message: "Search is responding normally from all regions. We are monitoring the results.",
        author: "Beacon",
      },
      {
        afterMs: 50 * MINUTE,
        status: "resolved",
        message: "Search has been healthy for 3 minutes. This incident has been resolved.",
        author: "Beacon",
      },
    ],
  },
  {
    monitor: "session-cache",
    title: "Session cache is unavailable",
    impact: "major",
    automated: true,
    startedAgoMs: 73 * DAY + 9 * HOUR,
    durationMs: 6 * MINUTE,
    disruption: { kind: "down", severity: 1 },
    timeline: [
      {
        afterMs: 0,
        status: "investigating",
        message:
          "Automated checks detected that Session cache is failing from 3 of 3 regions. We are investigating.",
        author: "Beacon",
      },
      {
        afterMs: 6 * MINUTE,
        status: "monitoring",
        message: "Session cache is responding normally from all regions. We are monitoring the results.",
        author: "Beacon",
      },
      {
        afterMs: 9 * MINUTE,
        status: "resolved",
        message: "Session cache has been healthy for 3 minutes. This incident has been resolved.",
        author: "Beacon",
      },
    ],
  },
];
