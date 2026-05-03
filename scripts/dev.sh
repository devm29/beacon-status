#!/usr/bin/env bash
# Runs the whole stack locally without Docker: MongoDB and Redis as processes, one prober per
# region, the evaluator, the API, the chaos target and the Next.js app. Ctrl-C stops everything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
set -a
# shellcheck disable=SC1091
source .env
set +a

./scripts/infra.sh up
pnpm --filter @beacon/shared build >/dev/null

# Job control puts every service in its own process group, so cleanup can stop pnpm, tsx and
# their children together instead of orphaning watchers.
set -m
pids=()
run() {
  local name="$1"
  shift
  ( "$@" 2>&1 | sed -u "s/^/[$name] /" ) &
  pids+=("$!")
}

cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

run chaos pnpm --filter @beacon/chaos-target dev
# Probers start once the demo target answers, so the first round is not a false outage.
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "${CHAOS_URL:-http://127.0.0.1:5511}/health" 2>/dev/null && break
  sleep 0.5
done
run api pnpm --filter @beacon/api dev
run evaluator pnpm --filter @beacon/evaluator dev
for region in us-east eu-west ap-southeast; do
  run "probe:$region" env REGION="$region" pnpm --filter @beacon/prober dev
done
run web pnpm --filter @beacon/web exec next dev --turbopack -p 3111

wait
