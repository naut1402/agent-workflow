#!/usr/bin/env bash
# Deploy helper. Usage: ./docker/install.sh [--runners|--down]
# Reads docker/.env (--env-file). Creates from .env.example if missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/docker/.env"
ENV_EXAMPLE="$ROOT/docker/.env.example"

WITH_RUNNERS=0
DO_DOWN=0
for arg in "$@"; do
  case "$arg" in
    --runners|-r) WITH_RUNNERS=1 ;;
    --down) DO_DOWN=1 ;;
    -h|--help)
      sed -n '2,4p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    if [ "$(id -u)" != "0" ]; then
      tmp="${ENV_FILE}.tmp"
      sed \
        -e "s|^PUID=.*|PUID=$(id -u)|" \
        -e "s|^PGID=.*|PGID=$(id -g)|" \
        -e "s|^HOST_HOME=.*|HOST_HOME=$HOME|" \
        -e "s|^DEV_TEAM_PROJECT_PATH=.*|DEV_TEAM_PROJECT_PATH=$HOME/workspace|" \
        "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
    fi
    echo "==> created $ENV_FILE"
  else
    echo "!! missing $ENV_EXAMPLE" >&2
    exit 1
  fi
fi

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|\#*) continue ;;
  esac
  key="${line%%=*}"
  val="${line#*=}"
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  case "$key" in
    ''|*[!A-Za-z0-9_]*) continue ;;
  esac
  if [ -z "${!key+x}" ]; then
    export "$key=$val"
  fi
done < "$ENV_FILE"

export PUID="${PUID:-$(id -u)}"
export PGID="${PGID:-$(id -g)}"
export HOST_HOME="${HOST_HOME:-$HOME}"
export DEV_TEAM_PROJECT_PATH="${DEV_TEAM_PROJECT_PATH:-$HOME/workspace}"
export DEV_TEAM_DASHBOARD_PORT="${DEV_TEAM_DASHBOARD_PORT:-5174}"
export FIX_PROJECT_OWNERSHIP="${FIX_PROJECT_OWNERSHIP:-0}"

if [ "$PUID" = "0" ] || [ "$PGID" = "0" ]; then
  echo "!! WARNING: PUID/PGID=0" >&2
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker/compose.yml)
if [ "$WITH_RUNNERS" -eq 1 ]; then
  COMPOSE+=(-f docker/compose.runners.yml)
fi

if [ "$DO_DOWN" -eq 1 ]; then
  echo "==> down"
  "${COMPOSE[@]}" down
  exit 0
fi

if [ ! -d "$DEV_TEAM_PROJECT_PATH" ]; then
  echo "==> mkdir $DEV_TEAM_PROJECT_PATH"
  mkdir -p "$DEV_TEAM_PROJECT_PATH"
fi

if [ "$WITH_RUNNERS" -eq 1 ]; then
  if [ -z "${HOST_HOME:-}" ] || [ "$HOST_HOME" = "/home/youruser" ]; then
    echo "!! set HOST_HOME in docker/.env (got '$HOST_HOME')" >&2
    exit 1
  fi
  mkdir -p "$HOST_HOME/.claude" "$HOST_HOME/.cursor" "$HOST_HOME/.dev-team-dashboard"
  if [ ! -f "$HOST_HOME/.claude.json" ]; then
    echo '{}' > "$HOST_HOME/.claude.json"
  fi
  if [ ! -f "$HOST_HOME/.dev-team-dashboard/credentials.json" ]; then
    cat > "$HOST_HOME/.dev-team-dashboard/credentials.json" <<'EOF'
{"version":1,"profiles":[{"id":"claude-default","provider":"claude-code-cli","label":"Claude Code (logged-in CLI)","secretRef":"cli-session"}]}
EOF
  fi
  if [ ! -f "$HOST_HOME/.claude/.credentials.json" ] && [ ! -f "$HOST_HOME/.claude/credentials.json" ]; then
    echo "!! WARNING: missing $HOST_HOME/.claude/.credentials.json" >&2
  fi
fi

echo "==> deploy (env-file=$ENV_FILE)"
echo "    PUID=$PUID PGID=$PGID"
echo "    DEV_TEAM_PROJECT_PATH=$DEV_TEAM_PROJECT_PATH"
echo "    HOST_HOME=$HOST_HOME"
echo "    runners=$WITH_RUNNERS FIX_PROJECT_OWNERSHIP=$FIX_PROJECT_OWNERSHIP"
echo "    UI http://127.0.0.1:${DEV_TEAM_DASHBOARD_PORT}/"

"${COMPOSE[@]}" up -d --build

echo "==> status"
"${COMPOSE[@]}" ps
