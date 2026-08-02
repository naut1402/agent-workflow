#!/bin/sh
# Drop root before starting the dashboard so Claude CLI can use
# --dangerously-skip-permissions (blocked for uid 0).
set -e

mkdir -p /data/dashboard-home /home/dashboard/.claude /home/dashboard/.cursor

# Named volume only — NEVER chown -R /home/dashboard (host bind mounts
# .claude/.cursor can hang for minutes on Docker Desktop).
chown -R dashboard:dashboard /data/dashboard-home 2>/dev/null || true
chown dashboard:dashboard /home/dashboard 2>/dev/null || true
# credentials.json may be a host file bind; best-effort
chown dashboard:dashboard /data/dashboard-home/credentials.json 2>/dev/null || true

export HOME=/home/dashboard
export USER=dashboard
export PATH="/home/dashboard/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [ "$(id -u)" = "0" ]; then
  exec runuser -u dashboard -- env HOME="$HOME" USER="$USER" PATH="$PATH" "$@"
fi

exec "$@"
