#!/usr/bin/env bash
# Runs MongoDB and Redis as local processes for development without Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.data"
MONGO_PORT="${MONGO_PORT:-27111}"
REDIS_PORT="${REDIS_PORT:-6411}"

up() {
  mkdir -p "$DATA/mongo" "$DATA/redis" "$DATA/logs"
  if ! mongosh --quiet --port "$MONGO_PORT" --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1; then
    mongod --dbpath "$DATA/mongo" --port "$MONGO_PORT" --bind_ip 127.0.0.1 \
      --fork --logpath "$DATA/logs/mongod.log" --pidfilepath "$DATA/mongod.pid" >/dev/null
    echo "mongod started on :$MONGO_PORT"
  else
    echo "mongod already running on :$MONGO_PORT"
  fi
  if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --dir "$DATA/redis" --daemonize yes \
      --pidfile "$DATA/redis.pid" --logfile "$DATA/logs/redis.log" --save "" --appendonly no
    echo "redis started on :$REDIS_PORT"
  else
    echo "redis already running on :$REDIS_PORT"
  fi
}

down() {
  mongosh --quiet --port "$MONGO_PORT" --eval 'db.getSiblingDB("admin").shutdownServer()' >/dev/null 2>&1 || true
  redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
  echo "infra stopped"
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 1 ;;
esac
