<div align="center">

<img src="docs/logo.svg" width="72" height="72" alt="Beacon logo" />

# Beacon

**Uptime monitoring, automatic incidents and public status pages, probed from three regions and declared down only when two of them agree.**

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)](package.json)
[![Next.js](https://img.shields.io/badge/Next.js-15%20App%20Router-000000?logo=nextdotjs&logoColor=white)](apps/web)
[![MongoDB](https://img.shields.io/badge/MongoDB-7%20time--series-47A248?logo=mongodb&logoColor=white)](packages/core/src/models/check-result.ts)
[![Redis](https://img.shields.io/badge/Redis%207-BullMQ-DC382D?logo=redis&logoColor=white)](packages/core/src/queues.ts)
[![Socket.IO](https://img.shields.io/badge/Socket.IO%20%2B%20SSE-realtime-010101?logo=socketdotio&logoColor=white)](apps/api/src/realtime)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-lightgrey.svg)](LICENSE)

[Why](#why-this-exists) · [Features](#features) · [Screenshots](#screenshots) · [Architecture](#architecture) · [Quickstart](#quickstart) · [Chaos demo](#the-chaos-demo) · [API](#api-overview) · [Decisions](#engineering-decisions-and-trade-offs) · [Testing](#testing)

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/overview-light.png" />
  <img alt="Beacon operator dashboard: monitor health, open incidents, 30-day uptime, latency sparklines and a live feed of regional check results" src="docs/screenshots/overview-light.png" width="100%" />
</picture>

</div>

---

## Why this exists

Most uptime checkers make two mistakes that wake people up for nothing. They probe from one place, so a
blip on the prober's own network looks like your outage. And they alert on single failures, so a
service that wobbles for ten seconds opens and closes an incident every minute.

Beacon is a self-hostable monitor in the space of OpenStatus and Better Stack, built around the SRE
practices that fix this:

- **Quorum detection.** Three region workers probe every monitor. A monitor is down only when two of
  the three agree, for several consecutive rounds.
- **Hysteresis and flap protection.** Recovery takes more healthy rounds than failure does, the
  threshold doubles while a monitor is flapping, and pages for a flapping monitor are held back.
- **SLOs and burn rates, not just uptime.** Each SLO gets an error budget and the multi-window,
  multi-burn-rate alerts from the Google SRE workbook.
- **Everything as code.** Monitors, SLOs, alert channels and the status page live in a
  `beacon.yaml` with Terraform-style `plan` and `apply`.

A chaos service ships in the stack, so you can break a dependency on purpose and watch the whole
chain react: detection, incident, alert, status page.

## Features

|                            |                                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Four check types**       | HTTP (method, headers, body, expected status like `2xx`), keyword (contains or absent), TCP connect, and SSL certificate expiry with warning and critical thresholds.                                                                                 |
| **Regional probing**       | A BullMQ job scheduler per monitor in each region's queue (`probe-us-east`, `probe-eu-west`, `probe-ap-southeast`). Each prober replica consumes only its own queue, and a simulated RTT makes regions look geographically distinct.                  |
| **Quorum + hysteresis**    | Pure, unit-tested evaluation function: votes from fresh regions only, round-based streaks, `failThreshold` / `recoverThreshold`, flap detection over a sliding window.                                                                                |
| **Time-series storage**    | Raw results in a MongoDB time-series collection with TTL retention, rolled up into 1m / 1h / 1d buckets by idempotent `$merge` aggregation pipelines. Rollups carry mergeable latency histograms, so p95 stays correct at every granularity.          |
| **Incident state machine** | `investigating → identified → monitoring → resolved`. Opens automatically, moves to monitoring on recovery, resolves itself after a cool-down, reopens if the failure returns within 15 minutes, and accepts manual timeline updates.                 |
| **SLOs and error budgets** | Per-monitor targets over 7, 28, 30 or 90 days. Budget burn-down, burn-rate charts, and four burn policies (fast, sustained, slow, creeping) scaled to the SLO window.                                                                                 |
| **Alert channels**         | Email (SMTP, Mailpit in Docker), Slack, Discord and HMAC-signed generic webhooks behind one provider interface. Per-channel dedup, escalation delay, monitor filters, maintenance-window suppression and a delivery log that explains every decision. |
| **Monitoring as code**     | `beacon.yaml` validated by the same Zod schemas the API uses, synced by a Commander CLI with `init`, `validate`, `plan`, `apply`, `export` and `status`.                                                                                              |
| **Public status page**     | `/status/[slug]` rendered by Next.js with ISR, revalidated on demand by the API, and kept live over Server-Sent Events. 90-day uptime bars, component groups, incident history and an embeddable SVG badge.                                           |
| **Operator dashboard**     | Next.js + shadcn/ui console with Recharts latency sparklines and a live Socket.IO feed of every regional check result.                                                                                                                                |
| **Chaos target**           | A small Express service that can go `slow`, `errors`, `flaky`, `down` or serve the wrong `content`, for every region or only some.                                                                                                                    |

<p align="center">
  <img src="docs/screenshots/badge.svg" alt="Example status badge served by the API" />
  <br />
  <sub>The embeddable badge, served by <code>GET /public/status/acme/badge.svg</code></sub>
</p>

## Screenshots

**Public status page.** ISR-rendered, live over SSE, with 90-day uptime bars per component.

![Public status page with every component operational](docs/screenshots/status-page-light.png)

**On a phone.** The status page, the operator overview and the monitor list at 390px wide. Below
the `sm` breakpoint KPI tiles sit two to a row and the region chips column is dropped, so tables
never scroll sideways.

<p>
  <img src="docs/screenshots/status-page-mobile.png" width="24%" alt="Public status page on a phone, all systems operational" />
  <img src="docs/screenshots/status-page-outage-mobile.png" width="24%" alt="Public status page on a phone during an outage, with active incidents" />
  <img src="docs/screenshots/overview-mobile.png" width="24%" alt="Operator overview on a phone with KPI tiles two to a row" />
  <img src="docs/screenshots/monitors-mobile.png" width="24%" alt="Monitor list on a phone, grouped by status page section" />
</p>

**The same page during the chaos demo.** Incidents are opened and announced with no operator involved.

![Public status page during a partial outage with three active incidents](docs/screenshots/status-page-outage-light.png)

**Overview during an outage.** All three regions agree, three monitors are down, and failures stream in live.

![Operator overview with three monitors down and failed checks in the live feed](docs/screenshots/overview-outage-light.png)

**Automatic incident.** Opened by the evaluator, with the per-region evidence in the first update.

![Live incident opened by quorum detection](docs/screenshots/incident-live-light.png)

**Monitor detail.** Per-region latency, p50 and p95 from merged histograms, and availability.

![Checkout API monitor detail with per-region latency charts](docs/screenshots/monitor-detail-light.png)

**SLO detail.** Budget burn-down, burn rate and the multi-window alert table.

![Checkout availability SLO with budget burn-down and burn-rate alerts](docs/screenshots/slo-detail-light.png)

**Alerts.** Channels and a delivery log with the reason for every send, skip or suppression.

![Alert channels and delivery log](docs/screenshots/alerts-light.png)

**Monitoring as code.** Badge snippet, CLI usage and the org's current config as YAML.

![Settings page with the exported beacon.yaml](docs/screenshots/settings-light.png)

**New monitor.** Validated by the shared Zod schema in the browser and the API.

![New monitor sheet](docs/screenshots/new-monitor-light.png)

**Incident history.** Operator updates through every stage of the state machine.

![Resolved incident timeline](docs/screenshots/incident-detail-light.png)

## Architecture

```mermaid
flowchart TB
  subgraph Clients
    direction LR
    OP["Operator browser"]
    PUB["Status page visitor"]
    CLI["beacon CLI"]
  end

  subgraph Web["apps/web: Next.js 15"]
    direction LR
    DASH["Operator dashboard"]
    STATUS["/status/[slug] ISR page"]
    REVAL["/api/revalidate"]
  end

  subgraph API["apps/api: Express"]
    direction LR
    REST["REST /v1"]
    PUBLIC["/public status + badge"]
    SIO["Socket.IO"]
    SSE["SSE hub"]
    FAN["Event fan-out"]
  end

  subgraph Data["State"]
    direction LR
    REDIS[("Redis 7<br/>BullMQ queues + pub/sub")]
    MONGO[("MongoDB 7<br/>time-series + rollups")]
  end

  subgraph Workers["Workers"]
    direction LR
    subgraph Probers["apps/prober x3"]
      P1["us-east"]
      P2["eu-west"]
      P3["ap-southeast"]
    end
    subgraph Evaluator["apps/evaluator"]
      EVAL["Quorum + hysteresis"]
      INC["Incident state machine"]
      NOTIFY["Alert delivery"]
      MAINT["Rollups, SLO burn, sweeper"]
    end
  end

  TARGET["apps/chaos-target"]
  CHANNELS["Email, Slack, Discord, Webhook"]

  OP --> DASH
  PUB --> STATUS
  CLI -- "plan / apply" --> REST
  DASH --> REST
  SIO -. "live checks" .-> DASH
  STATUS --> PUBLIC
  SSE -. "live updates" .-> PUB

  REST -- "monitors, incidents, SLOs" --> MONGO
  REST -- "upsert job schedulers" --> REDIS
  REDIS -- "probe-region queues" --> Probers
  Probers -- "HTTP / TCP / TLS" --> TARGET
  Probers -- "insert check_results" --> MONGO
  Probers -- "check-results queue" --> REDIS
  REDIS -- "result jobs" --> EVAL
  EVAL --> INC --> NOTIFY --> CHANNELS
  EVAL -- "CAS state" --> MONGO
  MAINT -- "$group + $merge" --> MONGO
  INC -- "publish events" --> REDIS
  REDIS -- "beacon:events" --> FAN
  FAN --> SIO
  FAN --> SSE
  FAN -- "revalidateTag" --> REVAL
```

| Package             | Role                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`          | Express REST API (`/v1`, API-key auth), public status JSON and SVG badge, Socket.IO for operators, SSE for status pages, config plan/apply endpoints, ISR revalidation webhook calls.                                |
| `apps/prober`       | BullMQ worker, run as three replicas with a `REGION` env (or one dev process for all three). Runs the check, writes to `check_results`, enqueues the result and publishes a `check.result` event.                    |
| `apps/evaluator`    | Consumes results, applies quorum and hysteresis with optimistic concurrency, drives incidents, delivers notifications, and runs scheduled maintenance jobs (rollups, SLO burn, incident sweep, scheduler reconcile). |
| `apps/web`          | Next.js 15 App Router, shadcn/ui, Recharts. Operator console and public `/status/[slug]` pages.                                                                                                                      |
| `apps/chaos-target` | The service the demo monitors, with an admin endpoint to degrade it and webhook sinks that record alert deliveries.                                                                                                  |
| `packages/shared`   | Zod schemas and pure domain logic: checks, monitors, `beacon.yaml`, evaluation, incident transitions, SLO math, uptime bars, histograms, realtime events.                                                            |
| `packages/core`     | Mongoose models, repositories, queues, scheduler, rollup / SLO / incident / alert services, egress guard and the demo seed.                                                                                          |
| `packages/cli`      | The `beacon` CLI (Commander).                                                                                                                                                                                        |

### Core flow: from a failed probe to a status page update

```mermaid
sequenceDiagram
  autonumber
  participant Q as BullMQ probe-region queue
  participant P as Prober (x3 regions)
  participant M as MongoDB
  participant R as Redis
  participant E as Evaluator
  participant A as API
  participant W as Next.js web
  participant V as Visitor

  Q->>P: job scheduler fires every intervalSeconds
  P->>P: run HTTP / keyword / TCP / SSL check
  P->>M: insert into check_results (time-series)
  P->>R: add to check-results queue, publish check.result
  R->>E: result job
  E->>M: read monitor state
  E->>E: evaluate(): fresh votes, quorum verdict, round streaks
  E->>M: compare-and-set state + pendingReaction (version check)
  alt quorum says down for failThreshold rounds
    E->>M: open incident (investigating) + timeline entry
    E->>M: persist notifications (dedup, maintenance, escalation delay)
    E->>R: enqueue deliveries, publish monitor.status + incident.changed
    E->>M: clear pendingReaction
  end
  R->>A: beacon:events
  A-->>V: SSE frame (public events only)
  A->>W: POST /api/revalidate with tag status:slug (debounced)
  W->>A: GET /public/status/slug on next request
  W-->>V: regenerated status page
```

### Monitor evaluation and incident lifecycle

```mermaid
stateDiagram-v2
  state "Monitor status" as MS {
    [*] --> pending
    pending --> up: first healthy round
    pending --> down: quorum down x failThreshold
    up --> degraded: quorum degraded x failThreshold
    degraded --> up: healthy x failThreshold
    up --> down: quorum down x failThreshold
    degraded --> down: quorum down x failThreshold
    down --> up: healthy x recoverThreshold (x2 while flapping)
  }
  state "Incident" as IN {
    [*] --> investigating: monitor down
    investigating --> identified: operator update
    identified --> monitoring: monitor recovered
    investigating --> monitoring: monitor recovered
    monitoring --> investigating: fails again
    monitoring --> resolved: healthy for RESOLVE_AFTER_SECONDS
    resolved --> investigating: fails within REOPEN_WINDOW_SECONDS
    resolved --> [*]
  }
```

### Data model

```mermaid
erDiagram
  ORGS ||--o{ MONITORS : owns
  ORGS ||--o{ INCIDENTS : has
  ORGS ||--o{ SLOS : defines
  ORGS ||--o{ CHANNELS : configures
  ORGS ||--o{ MAINTENANCE_WINDOWS : schedules
  MONITORS ||--o{ CHECK_RESULTS : "probed into"
  MONITORS ||--o{ ROLLUPS : "summarized by"
  MONITORS ||--o{ SLOS : "measured by"
  MONITORS }o--o{ INCIDENTS : affects
  INCIDENTS ||--o{ INCIDENT_UPDATES : timeline
  CHANNELS ||--o{ NOTIFICATIONS : delivers
  INCIDENTS ||--o{ NOTIFICATIONS : triggers

  ORGS {
    ObjectId _id
    string slug UK
    object statusPage
    array apiKeys "hashed"
  }
  MONITORS {
    ObjectId _id
    string key "unique per org"
    object check "http keyword tcp ssl"
    int intervalSeconds
    array regions
    int quorum
    int failThreshold
    int recoverThreshold
    object state "votes, streaks, version"
    string managedBy "config or ui"
  }
  CHECK_RESULTS {
    date ts "timeField"
    object meta "monitorId orgId region"
    string status
    number latencyMs
    string error
  }
  ROLLUPS {
    ObjectId monitorId
    string granularity "1m 1h 1d"
    date bucket
    int total
    int up
    int down
    array hist "latency histogram"
    date expiresAt "TTL"
  }
  INCIDENTS {
    ObjectId _id
    string status
    string impact
    bool automated
    date startedAt
    date resolvedAt
  }
  INCIDENT_UPDATES {
    ObjectId incidentId
    string status
    string message
    string author
  }
  SLOS {
    ObjectId monitorId
    number target
    int windowDays
    object lastEvaluation
  }
  CHANNELS {
    string key
    object target "email slack discord webhook"
    array events
    int escalationDelaySeconds
  }
  NOTIFICATIONS {
    string event
    string dedupKey
    string status "pending sent failed suppressed skipped"
    string reason
    date deliverAfter
  }
  MAINTENANCE_WINDOWS {
    date startsAt
    date endsAt
    array monitors
  }
```

Redis holds the BullMQ queues (`probe-<region>`, `check-results`, `notifications`, `maintenance`),
alert dedup keys and the `beacon:events` pub/sub channel.

## User flow

```mermaid
flowchart TD
  A["Sign in with an org API key"] --> B{"How do you define monitors?"}
  B -- "Dashboard" --> C["New monitor sheet"]
  B -- "Code" --> D["Edit beacon.yaml"]
  D --> E["beacon plan: review the diff"]
  E --> F["beacon apply: confirm with yes"]
  C --> G["Schedulers registered in 3 region queues"]
  F --> G
  G --> H["Overview: live checks and sparklines"]
  H --> I{"Quorum says down?"}
  I -- "No" --> H
  I -- "Yes" --> J["Incident opens automatically"]
  J --> K["Channels alerted, unless in maintenance or deduped"]
  J --> L["Status page updates live"]
  K --> M["Operator posts timeline updates"]
  M --> N["Monitor recovers: incident moves to monitoring"]
  N --> O["Auto-resolves after the cool-down"]
  O --> P["SLO page shows the budget it cost"]
```

## Tech stack

| Layer      | Choice                                                                                               | Why                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language   | TypeScript 5.9, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`                   | Domain logic with many optional fields and indexed lookups; the compiler catches the gaps.                                                                                                                               |
| Runtime    | Node.js 22, ES modules                                                                               | Native `fetch`, `AbortSignal.timeout`, `node:tls` for certificate checks.                                                                                                                                                |
| API        | Express 5, helmet, pino-http                                                                         | Small surface, explicit middleware order, structured logs.                                                                                                                                                               |
| Validation | Zod 4, shared between API, CLI, web and env parsing                                                  | One schema for `beacon.yaml`, request bodies and form validation.                                                                                                                                                        |
| Storage    | MongoDB 7 + Mongoose: time-series collection, aggregation pipelines, TTL indexes                     | Raw probe results are append-only time series; rollups are a natural `$group` + `$merge`.                                                                                                                                |
| Jobs       | Redis 7 + BullMQ job schedulers                                                                      | Repeatable per-monitor schedules, sharding by queue, retries with backoff, delayed jobs for escalation.                                                                                                                  |
| Realtime   | Socket.IO (operators), Server-Sent Events (public), Redis pub/sub                                    | Authenticated bidirectional channel for the console, cache-friendly one-way stream for anonymous visitors.                                                                                                               |
| Frontend   | Next.js 15 App Router, ISR + `revalidateTag`, shadcn/ui, Tailwind 4, Recharts, next-themes           | Status pages are static until something changes. The console pairs IBM Plex Sans with Plex Mono (bundled, so builds never fetch fonts) and keeps one deep-teal accent, leaving green, amber and red to mean status only. |
| CLI        | Commander, `yaml`                                                                                    | Familiar plan/apply UX with Terraform-style exit codes.                                                                                                                                                                  |
| Alerts     | nodemailer (SMTP / Mailpit), Slack and Discord webhooks, HMAC-signed webhooks                        | Provider interface keyed by channel type.                                                                                                                                                                                |
| Tooling    | pnpm workspaces, Vitest, Supertest, Playwright, ESLint (typescript-eslint), Prettier, Docker Compose |                                                                                                                                                                                                                          |

## Quickstart

### Local, no Docker

Requires Node 22 (see `.nvmrc`), pnpm 9 (`corepack enable` picks the pinned version), and `mongod`,
`mongosh`, `redis-server` on your `PATH`. If you would rather not install MongoDB and Redis, run
only those two from Compose (`docker compose up -d mongo redis`); they listen on the same ports.

```bash
pnpm install
./scripts/infra.sh up   # MongoDB on :27111 and Redis on :6411, data under .data/
pnpm seed               # demo org "acme": 8 monitors, 90 days of history, SLOs, channels, incidents
pnpm dev                # chaos target, API, evaluator, 3 region probers and the web app
```

|                    |                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Operator dashboard | http://localhost:3111 (signed in automatically in development; the key is `bk_demo_acme_local_development_key`) |
| Public status page | http://localhost:3111/status/acme                                                                               |
| API                | http://localhost:8111 (`/healthz`, `/readyz`)                                                                   |
| Status badge       | http://localhost:8111/public/status/acme/badge.svg                                                              |

`pnpm dev` copies `.env.example` to `.env` if it is missing. Stop with `Ctrl-C`, then `./scripts/infra.sh down`.

### Docker Compose

```bash
cp .env.example .env
# production refuses the development secrets, so replace these three:
#   REALTIME_SECRET, REVALIDATE_SECRET, CHAOS_ADMIN_TOKEN   (e.g. openssl rand -hex 32)
docker compose up --build
```

Compose runs MongoDB, Redis, Mailpit (alert emails at http://localhost:8025), the chaos target, a
one-shot seed job, **three prober containers** (one per region), the evaluator, the API and the web
app. MongoDB and Redis bind to `127.0.0.1` only.

### The chaos demo

```bash
./scripts/chaos.sh down                # every region loses the target
./scripts/chaos.sh down ap-southeast   # one region only: quorum keeps monitors up
./scripts/chaos.sh slow                # +2.5s latency: monitors with a latency budget go degraded
./scripts/chaos.sh content             # storefront drops "Add to cart": keyword monitor fails
./scripts/chaos.sh flaky               # intermittent 502s: watch flap protection hold back pages
./scripts/chaos.sh healthy             # recover
./scripts/chaos.sh status
```

Within about two check intervals of `down`, the affected monitors flip to down, incidents open,
the Slack, Discord and pager sinks on the chaos target receive deliveries (escalation delay
permitting), and the public status page changes without a reload. After `healthy`, incidents move
to monitoring and resolve themselves three minutes later.

### Monitoring as code

```bash
pnpm beacon validate -f examples/beacon.yaml          # offline schema check
pnpm beacon plan     -f examples/beacon.yaml          # diff against the server
pnpm beacon apply    -f examples/beacon.yaml --prune  # confirm with "yes", or --auto-approve
pnpm beacon export   -o beacon.yaml                   # current state, secrets as ${PLACEHOLDERS}
pnpm beacon status
```

<!-- prettier-ignore -->
```yaml
version: 1
statusPage:
  title: Acme Cloud Status
  groups: [Storefront, Core platform, Edge & certificates]
monitors:
  - key: checkout-api
    name: Checkout API
    group: Storefront
    check: { type: http, url: "${CHAOS_URL:-http://127.0.0.1:5511}/api/checkout" }
    intervalSeconds: 30
    degradedLatencyMs: 800
slos:
  - { key: checkout-availability, name: Checkout availability, monitor: checkout-api, target: 99.9, windowDays: 30 }
channels:
  - key: pager-bridge
    name: Pager bridge
    target: { type: webhook, url: "${PAGER_WEBHOOK_URL}", secret: "${PAGER_WEBHOOK_SECRET}" }
    events: [incident.opened, incident.resolved, slo.burn]
    escalationDelaySeconds: 120
```

`${VAR:-default}` placeholders are expanded from the environment, so secrets never live in the
file. The full example is in [`examples/beacon.yaml`](examples/beacon.yaml).

`plan --detailed-exitcode` follows Terraform: 0 for no changes, 2 for drift, 1 for errors. `pnpm run`
reports every non-zero exit as 1, so a drift check in a script should call the built CLI directly:

```bash
pnpm --filter "@beacon/cli..." build
node --env-file-if-exists=.env packages/cli/dist/main.js plan -f examples/beacon.yaml --detailed-exitcode
```

## Configuration

All services read one `.env` (see [`.env.example`](.env.example)); every service validates its
environment with Zod at startup and lists every problem at once.

| Variable                                 | Default                                | Used by             | Purpose                                                                       |
| ---------------------------------------- | -------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `MONGO_URL`                              | `mongodb://127.0.0.1:27111/beacon`     | all                 | MongoDB connection                                                            |
| `REDIS_URL`                              | `redis://127.0.0.1:6411`               | all                 | BullMQ and pub/sub                                                            |
| `RAW_RETENTION_DAYS`                     | `14`                                   | all                 | TTL of the `check_results` time-series collection                             |
| `ALLOW_PRIVATE_TARGETS`                  | `false` (`.env.example`: `true`)       | prober, evaluator   | Allow probes and webhooks to reach private, loopback and link-local addresses |
| `API_PORT`                               | `8111`                                 | api                 | HTTP port                                                                     |
| `CORS_ORIGINS`                           | `http://localhost:3111,...`            | api                 | Origins allowed on `/v1` and Socket.IO                                        |
| `REALTIME_SECRET`                        | dev default                            | api                 | HMAC key for Socket.IO tokens; must be unique in production                   |
| `REVALIDATE_SECRET`                      | dev default                            | api, web            | Shared secret for the ISR revalidation webhook                                |
| `WEB_REVALIDATE_URL`                     | unset                                  | api                 | Where to POST revalidation requests                                           |
| `PUBLIC_RATE_LIMIT_PER_MINUTE`           | `300`                                  | api                 | Rate limit on `/public`                                                       |
| `AUTH_FAILURES_PER_15_MINUTES`           | `50`                                   | api                 | Failed API-key attempts allowed per IP                                        |
| `SSE_MAX_PER_IP` / `SSE_MAX_PER_ORG`     | `20` / `5000`                          | api                 | Open status-page streams allowed                                              |
| `STATUS_CACHE_TTL_SECONDS`               | `10`                                   | api                 | In-process cache of the public status payload                                 |
| `REGION`                                 | all three                              | prober              | Comma list of regions this process serves                                     |
| `PROBE_CONCURRENCY`                      | `25`                                   | prober              | Concurrent probes per region                                                  |
| `SIMULATED_RTT_MS`                       | `us-east:0,eu-west:38,ap-southeast:92` | prober              | Latency added per simulated region                                            |
| `SMTP_URL`                               | unset (emails are logged)              | evaluator           | SMTP server, e.g. `smtp://mailpit:1025`                                       |
| `EMAIL_FROM`                             | `Beacon <alerts@beacon.local>`         | evaluator           | Sender address                                                                |
| `RESOLVE_AFTER_SECONDS`                  | `180`                                  | evaluator           | Healthy time in `monitoring` before auto-resolve                              |
| `REOPEN_WINDOW_SECONDS`                  | `900`                                  | evaluator           | A failure this soon after resolution reopens the incident                     |
| `FLAP_WINDOW_MINUTES` / `FLAP_THRESHOLD` | `20` / `4`                             | evaluator           | Transitions in the window that mark a monitor as flapping                     |
| `FLAPPING_PAGE_DELAY_MINUTES`            | `10`                                   | evaluator           | How long a flapping monitor's page is held back                               |
| `RESULTS_CONCURRENCY`                    | `8`                                    | evaluator           | Parallel result evaluations                                                   |
| `WEBHOOK_TIMEOUT_MS`                     | `10000`                                | evaluator           | Timeout for Slack, Discord and webhook deliveries                             |
| `API_INTERNAL_URL` / `BROWSER_API_URL`   | `:8111`                                | web                 | API address for the server and for browsers                                   |
| `STATUS_REVALIDATE_SECONDS`              | `60`                                   | web                 | ISR ceiling for status pages                                                  |
| `BEACON_API_KEY`                         | demo key                               | web (dev only), CLI | Auto sign-in in development; CLI credentials                                  |
| `CHAOS_PORT` / `CHAOS_ADMIN_TOKEN`       | `5511` / unset                         | chaos target        | Port, and the bearer token required in production                             |
| `BEACON_API_URL`                         | `http://localhost:8111`                | CLI                 | API base URL                                                                  |

## API overview

All `/v1` routes take `Authorization: Bearer <api key>` and are scoped to the key's organization.
Request bodies are validated with the shared Zod schemas; errors come back as
`{ "error": { "code", "message", "details" } }`.

| Method                | Path                                 | Description                                                            |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `GET`                 | `/v1/me`                             | Current organization                                                   |
| `GET`                 | `/v1/overview`                       | Totals, open incidents, uptime and per-monitor stats for the dashboard |
| `GET` `POST`          | `/v1/monitors`                       | List or create monitors                                                |
| `GET` `PUT` `DELETE`  | `/v1/monitors/:id`                   | Read, replace or delete a monitor                                      |
| `POST`                | `/v1/monitors/:id/pause` · `/resume` | Pause or resume probing                                                |
| `GET`                 | `/v1/monitors/:id/results`           | Raw regional results, cursor-paginated                                 |
| `GET`                 | `/v1/monitors/:id/metrics?range=24h` | Latency percentiles and availability series from rollups               |
| `GET`                 | `/v1/monitors/:id/stats`             | Uptime and latency summary                                             |
| `GET` `POST`          | `/v1/incidents`                      | List (keyset pagination, `status=open                                  | resolved`) or declare an incident |
| `GET`                 | `/v1/incidents/:id`                  | Incident with its timeline                                             |
| `POST`                | `/v1/incidents/:id/updates`          | Post a timeline update; transitions are checked by the state machine   |
| `GET` `POST`          | `/v1/slos`                           | List or create SLOs                                                    |
| `GET` `DELETE`        | `/v1/slos/:id`                       | SLO report (SLI, budget, burn-down, burn windows) or delete            |
| `GET` `POST`          | `/v1/channels`                       | List (secrets redacted) or create alert channels                       |
| `PATCH` `DELETE`      | `/v1/channels/:id`                   | Enable, disable or delete a channel                                    |
| `POST`                | `/v1/channels/:id/test`              | Send a test notification                                               |
| `GET`                 | `/v1/notifications`                  | Delivery log                                                           |
| `GET` `POST` `DELETE` | `/v1/maintenance[/:id]`              | Maintenance windows                                                    |
| `POST`                | `/v1/config/plan`                    | Diff a `beacon.yaml` against current state; returns a `planHash`       |
| `POST`                | `/v1/config/apply`                   | Apply; rejected if state changed since the `planHash` was issued       |
| `GET`                 | `/v1/config/export`                  | Current state as config, credentials replaced by placeholders          |
| `POST`                | `/v1/realtime/token`                 | Short-lived HMAC token for the Socket.IO connection                    |
| `GET`                 | `/public/status/:slug`               | Public status payload (cached, CORS `*`)                               |
| `GET`                 | `/public/status/:slug/badge.svg`     | Overall badge, or `?component=<key>` for one component                 |
| `GET`                 | `/public/status/:slug/events`        | Server-Sent Events stream of public changes                            |
| `GET`                 | `/healthz` · `/readyz`               | Liveness and readiness (MongoDB and Redis)                             |

Webhook deliveries carry `x-beacon-event`, `x-beacon-delivery` and, when the channel has a secret,
a Stripe-style `x-beacon-signature: t=<unix>,v1=<hmac-sha256 of "t.body">`.

### Examples

Captured from the Compose stack with the seeded demo key.

```http
POST /v1/monitors
Authorization: Bearer bk_demo_acme_local_development_key
Content-Type: application/json

{ "key": "marketing-site", "name": "Marketing site", "group": "Storefront",
  "check": { "type": "http", "url": "http://chaos-target:5511/" }, "intervalSeconds": 60 }
```

```json
201 Created
{
  "id": "6aef91fe3290bc751bc6a439",
  "key": "marketing-site",
  "name": "Marketing site",
  "group": "Storefront",
  "check": { "type": "http", "url": "http://chaos-target:5511/", "method": "GET", "headers": {},
             "expectedStatus": ["2xx"], "followRedirects": true },
  "intervalSeconds": 60,
  "timeoutMs": 10000,
  "regions": ["us-east", "eu-west", "ap-southeast"],
  "quorum": 2,
  "failThreshold": 2,
  "recoverThreshold": 3,
  "managedBy": "ui",
  "status": "pending",
  "regionStatus": [],
  "inMaintenance": false
}
```

The same request with a bad key, an empty name and an `ftp://` URL is rejected field by field:

```json
400 Bad Request
{
  "error": {
    "code": "validation_failed",
    "message": "The request did not pass validation",
    "details": [
      { "path": "key", "message": "Use lowercase letters, numbers and single dashes, like public-api" },
      { "path": "name", "message": "Too small: expected string to have >=1 characters" },
      { "path": "check.url", "message": "Invalid URL" }
    ]
  }
}
```

Without a key:

```json
401 Unauthorized
{ "error": { "code": "unauthorized", "message": "Send an API key as `Authorization: Bearer <key>`" } }
```

`beacon plan` against the same stack, where the example file points the database checks at the
local-dev ports instead of the Compose service names:

```text
$ beacon validate -f examples/beacon.yaml
examples/beacon.yaml is valid: 6 monitors, 4 SLOs, 4 channels.

$ beacon plan -f examples/beacon.yaml
Beacon will perform the following actions:

  ~ monitor primary-database
      check.host: "mongo" -> "127.0.0.1"
      check.port: 27017 -> 27111
  ~ monitor session-cache
      check.host: "redis" -> "127.0.0.1"
      check.port: 6379 -> 6411
  ~ channel incidents-slack
      target.url: "(sensitive)" -> "(sensitive)"
  ...

Plan: 0 to create, 5 to update, 0 to delete (10 unchanged)
```

## Engineering decisions and trade-offs

**Quorum votes only count fresh regions.** A region's last observation votes for at most
`max(3 x interval, 90s)`. Without this, a crashed prober would keep voting with whatever it last
saw. If fewer than `quorum` regions are fresh, the verdict is `insufficient` and the state does not
move: Beacon prefers saying nothing to guessing.

**Hysteresis counts probe rounds, not results.** Regions report independently, so the evaluator
groups results into rounds (a round closes when every non-stale region has reported, or when one
reports twice). `failThreshold` and `recoverThreshold` count consecutive round verdicts, and
recovery needs twice as many healthy rounds while the monitor is flapping. The whole thing is a
pure function in `packages/shared/src/evaluation.ts`, unit-tested without a database.

**Optimistic concurrency plus an outbox.** Three regions finish at nearly the same moment, so
state updates are a compare-and-set on `state.version` with retries. A transition is written
together with the new state as a `pendingReaction`, and cleared only after the incident, alerts and
events succeeded. A sweeper replays reactions left behind by a crash, so an outage can never be
detected but not announced.

**Time-series collection for raw data, rollups for everything else.** Probers append to a
MongoDB time-series collection (`metaField: { monitorId, orgId, region }`) that expires after
`RAW_RETENTION_DAYS`. Rollups are rebuilt for a trailing window with `$group` and `$merge`
(`whenMatched: replace`), so re-running a window, late results and overlapping schedules are
harmless. 1m feeds 1h feeds 1d, and each level has its own TTL (3, 45 and 400 days). Charts, the
90-day bar and SLOs never scan raw data. An SLO window longer than the hourly retention (90 days)
reads its older part from daily rollups, so it is not silently cut to 45 days.

**Mergeable latency histograms.** Every rollup stores counts in fixed latency buckets
(25ms to 10s). An hourly histogram is the element-wise sum of its minutes, so p50 and p95 can be
estimated at any granularity. Averages of percentiles would have been wrong.

**SLO burn rates follow the SRE workbook.** Four policies: 14.4x over 1h and 5m (page), 6x over
6h and 30m (page), 3x over 24h and 2h (ticket), 1x over 72h and 6h (ticket). Both windows must
exceed the threshold to fire, which stops a resolved spike from paging. Thresholds scale with the
SLO window and never drop below 1x. Windows up to 6h read minute rollups and longer ones read
hourly rollups, so evaluating an SLO is two small indexed reads.

**Alert fatigue is a feature, and every decision is logged.** Notifications are persisted before
they are sent, with a status of `pending`, `sent`, `failed`, `suppressed` or `skipped` and a
reason. Redis `SET NX EX` dedups per channel. Escalation delays are re-checked at send time, so an
incident that resolved in the meantime pages nobody. Follow-ups go only to channels that were
paged for the opening. Maintenance suppresses an alert only if every monitor it concerns is
covered.

**Plan/apply with a plan hash.** `apply` recomputes the plan and rejects the request if its hash
differs from the one the user approved, so nothing changes that was not on screen. `--prune` only
deletes resources previously created from config (`managedBy: config`); monitors created in the UI
are adopted, never removed.

**Two realtime transports on purpose.** Operators get Socket.IO rooms authenticated by a
short-lived HMAC token, so the browser never holds an API key. Anonymous visitors get SSE with only
public events, per-IP and per-org connection caps and a heartbeat. The same event also invalidates
the API's status cache and triggers a debounced `revalidateTag("status:<slug>")`, so a burst of
events during an outage costs one page regeneration.

**One scheduler per monitor per region.** `upsertJobScheduler` in `probe-<region>` makes
scheduling idempotent: editing a monitor upserts, pausing removes, and a periodic reconcile deletes
schedulers whose monitor no longer exists. Each prober replica consumes only its own queue, which
is how work is sharded across regions.

**Egress guard.** Monitors and webhooks are user-supplied URLs. Unless `ALLOW_PRIVATE_TARGETS` is
on, the prober and alert delivery refuse private, loopback and link-local addresses (cloud metadata
endpoints included), and webhook redirects are never followed.

**Trade-offs worth naming.** Regions are simulated (one host, added RTT), so this demonstrates the
algorithm, not real network diversity. API keys are organization-scoped with no user accounts or
roles. The SSE hub and status cache are per API process; running several API replicas works
because every replica subscribes to Redis, but connection caps are per replica.

## Project structure

```text
beacon-status/
├── apps/
│   ├── api/               Express REST, public routes, Socket.IO, SSE, ISR revalidator
│   │   └── src/{routes,services,realtime,http}/
│   ├── prober/            BullMQ worker per region; checks/{http,tcp,ssl}.ts
│   ├── evaluator/         evaluation-service, delivery-service, maintenance-runner, providers/
│   ├── web/               Next.js 15: app/(dashboard), app/status/[slug], api/revalidate, e2e/
│   └── chaos-target/      Breakable demo service and webhook sinks
├── packages/
│   ├── shared/            Zod schemas + pure domain logic (evaluation, incident, slo, uptime, config)
│   ├── core/              Mongoose models, repositories, queues, scheduler, services, seed/
│   └── cli/               `beacon` CLI: init, validate, plan, apply, export, status
├── examples/beacon.yaml   Monitoring-as-code example for the demo org
├── scripts/               infra.sh, dev.sh, chaos.sh
├── docker/                Multi-stage Node Dockerfile (runtime and tools targets)
└── docker-compose.yml     Full stack with three prober containers and Mailpit
```

## Testing

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm --filter @beacon/web e2e    # Playwright smoke tests against a running, seeded stack
```

`pnpm test` runs 132 Vitest tests in 16 files across the 8 workspace packages (shared 34, api 27,
core 19, prober 15, cli 13, evaluator 11, web 7, chaos-target 6). The integration suites use a real
MongoDB and Redis (`TEST_MONGO_URL`, `TEST_REDIS_URL`, defaulting to the local dev ports, which
`./scripts/infra.sh up` or `docker compose up -d mongo redis` provide) and create an isolated
database per suite.

| Area             | What is covered                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluation       | Quorum, stale regions, round closing, fail and recover thresholds, flapping, out-of-order results                                                                                                          |
| Domain           | Incident transitions and automation, SLO budgets and burn policies, uptime bars, histograms, config planning                                                                                               |
| Prober           | HTTP, keyword, TCP and SSL checks against local servers; result persistence and publishing                                                                                                                 |
| Evaluator        | Concurrent results opening exactly one incident, paging and follow-up rules, maintenance windows, redelivered results, outbox replay, requeue of lost delivery jobs, Slack payloads and webhook signatures |
| Rollups and SLOs | 1m, 1h and 1d aggregation pipelines, idempotent re-runs, and SLO windows that outlive the hourly rollups                                                                                                   |
| API              | Supertest over auth, validation, monitors, incidents, SLOs, channels, config plan/apply, public routes and badges                                                                                          |
| Realtime         | Token signing, SSE limits and fan-out filtering, revalidation debouncing                                                                                                                                   |
| CLI              | Config parsing and env expansion, plan rendering, plan/apply with the plan hash, exit codes, confirmation, export                                                                                          |
| Web              | Formatting helpers; Playwright: sign in, create a monitor, run an incident to resolution, read the status page, fetch the badge                                                                            |

## Roadmap

- Real multi-region probers (Fly.io or Cloud Run regions) instead of simulated RTT
- User accounts, roles and per-user API keys
- Subscriber notifications for status page visitors (email and RSS)
- Custom domains for status pages
- Synthetic browser checks with Playwright
- OpenTelemetry traces across prober, evaluator and API
- Postmortem templates linked from resolved incidents

## License

[MIT](LICENSE)
