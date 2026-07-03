#!/bin/sh
# Ensure DEV_TEAM_DASHBOARD_HOME is writable by the app user when a Docker
# volume is mounted at /data (default root ownership on first create).
set -e

DATA="${DEV_TEAM_DASHBOARD_HOME:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p \
    "$DATA" \
    "$DATA/workspaces" \
    "$DATA/cache" \
    "$DATA/logs" \
    "$DATA/jobs"
  chown -R app:app "$DATA"
  exec su-exec app "$@"
fi

mkdir -p \
  "$DATA/workspaces" \
  "$DATA/cache" \
  "$DATA/logs" \
  "$DATA/jobs" 2>/dev/null || true

exec "$@"
