#!/usr/bin/env bash
# Breaks the demo target on purpose: ./scripts/chaos.sh down [us-east,eu-west]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${CHAOS_ADMIN_TOKEN:-}" ] && [ -f "$ROOT/.env" ]; then
  CHAOS_ADMIN_TOKEN="$(grep -E '^CHAOS_ADMIN_TOKEN=' "$ROOT/.env" | tail -n1 | cut -d= -f2- || true)"
fi

URL="${CHAOS_URL:-http://127.0.0.1:5511}"
MODE="${1:-}"
REGIONS="${2:-}"

case "$MODE" in
  healthy|slow|errors|down|flaky|content) ;;
  status) ;;
  *) echo "usage: $0 healthy|slow|errors|down|flaky|content|status [region,region]" >&2; exit 1 ;;
esac

regions_json="[]"
if [ -n "$REGIONS" ]; then
  regions_json="[\"${REGIONS//,/\",\"}\"]"
fi

auth=()
if [ -n "${CHAOS_ADMIN_TOKEN:-}" ]; then auth=(-H "authorization: Bearer $CHAOS_ADMIN_TOKEN"); fi

if [ "$MODE" = status ]; then
  curl -fsS "$URL/admin/state" ${auth[@]+"${auth[@]}"}
  echo
  exit 0
fi

curl -fsS -X PUT "$URL/admin/state" -H "content-type: application/json" ${auth[@]+"${auth[@]}"} \
  -d "{\"mode\":\"$MODE\",\"regions\":$regions_json}"
echo
