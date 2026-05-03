export const STARTER_CONFIG = `# Beacon monitoring-as-code. Run \`beacon plan\` to preview and \`beacon apply\` to sync.
version: 1

statusPage:
  title: My Company Status
  description: Live availability of our product.
  groups: [Product, Infrastructure]

monitors:
  - key: website
    name: Website
    group: Product
    check:
      type: keyword
      url: https://example.com/
      keyword: Example Domain
    intervalSeconds: 60

  - key: api
    name: Public API
    group: Product
    check:
      type: http
      url: https://example.com/health
      expectedStatus: [2xx]
    intervalSeconds: 30
    timeoutMs: 5000
    degradedLatencyMs: 800

  - key: certificate
    name: TLS certificate
    group: Infrastructure
    check:
      type: ssl
      host: example.com
      warnDays: 21

slos:
  - key: api-availability
    name: API availability
    monitor: api
    target: 99.9
    windowDays: 30

channels:
  - key: oncall
    name: On-call email
    target:
      type: email
      to: [oncall@example.com]
    events: [incident.opened, incident.resolved, slo.burn]

  - key: slack
    name: "#incidents"
    target:
      type: slack
      url: \${SLACK_WEBHOOK_URL:-https://hooks.slack.com/services/T000/B000/XXXX}
    events: [incident.opened, incident.updated, incident.resolved]
    escalationDelaySeconds: 60
`;
