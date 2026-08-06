#!/usr/bin/env bash
# Deploy sample — chạy từ bất kỳ đâu; tự tìm root repo.
#
# Usage:
#   ./docker/install.sh              # UI/API only
#   ./docker/install.sh --runners    # + Claude/Cursor auth mount
#   ./docker/install.sh --down
#   DEV_TEAM_PROJECT_PATH=/data/apps ./docker/install.sh --runners
#
# Defaults (LinuxServer-style):
#   PUID=$(id -u)  PGID=$(id -g)
#   DEV_TEAM_PROJECT_PATH=$HOME/workspace
#   HOST_HOME=$HOME
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_RUNNERS=0
DO_DOWN=0
for arg in "$@"; do
  case "$arg" in
    --runners|-r) WITH_RUNNERS=1 ;;
    --down) DO_DOWN=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

export PUID="${PUID:-$(id -u)}"
export PGID="${PGID:-$(id -g)}"
export HOST_HOME="${HOST_HOME:-$HOME}"
export DEV_TEAM_PROJECT_PATH="${DEV_TEAM_PROJECT_PATH:-$HOME/workspace}"
export DEV_TEAM_DASHBOARD_PORT="${DEV_TEAM_DASHBOARD_PORT:-5174}"
export FIX_PROJECT_OWNERSHIP="${FIX_PROJECT_OWNERSHIP:-0}"

if [ "$PUID" = "0" ] || [ "$PGID" = "0" ]; then
  echo "!! Cảnh báo: PUID/PGID=0 (root). Claude CLI chặn --dangerously-skip-permissions." >&2
  echo "   Dùng user thường: export PUID=\$(id -u) PGID=\$(id -g) khi KHÔNG phải root," >&2
  echo "   hoặc set PUID/PGID = uid sở hữu DEV_TEAM_PROJECT_PATH." >&2
fi

COMPOSE=(docker compose -f docker/compose.yml)
if [ "$WITH_RUNNERS" -eq 1 ]; then
  COMPOSE+=(-f docker/compose.runners.yml)
fi

if [ "$DO_DOWN" -eq 1 ]; then
  echo "==> down"
  "${COMPOSE[@]}" down
  exit 0
fi

if [ ! -d "$DEV_TEAM_PROJECT_PATH" ]; then
  echo "==> tạo DEV_TEAM_PROJECT_PATH=$DEV_TEAM_PROJECT_PATH"
  mkdir -p "$DEV_TEAM_PROJECT_PATH"
fi

if [ "$WITH_RUNNERS" -eq 1 ]; then
  mkdir -p "$HOST_HOME/.claude" "$HOST_HOME/.cursor" "$HOST_HOME/.dev-team-dashboard"
  if [ ! -f "$HOST_HOME/.claude.json" ]; then
    echo '{}' > "$HOST_HOME/.claude.json"
    echo "==> tạo $HOST_HOME/.claude.json"
  fi
  if [ ! -f "$HOST_HOME/.dev-team-dashboard/credentials.json" ]; then
    cat > "$HOST_HOME/.dev-team-dashboard/credentials.json" <<'EOF'
{"version":1,"profiles":[{"id":"claude-default","provider":"claude-code-cli","label":"Claude Code (logged-in CLI)","secretRef":"cli-session"}]}
EOF
    echo "==> tạo $HOST_HOME/.dev-team-dashboard/credentials.json"
  fi
  if [ ! -f "$HOST_HOME/.claude/.credentials.json" ] && [ ! -f "$HOST_HOME/.claude/credentials.json" ]; then
    echo "!! Cảnh báo: chưa có $HOST_HOME/.claude/.credentials.json — Claude trong container sẽ yêu cầu login (hoặc set ANTHROPIC_API_KEY)." >&2
  fi
fi

echo "==> deploy"
echo "    PUID=$PUID PGID=$PGID"
echo "    DEV_TEAM_PROJECT_PATH=$DEV_TEAM_PROJECT_PATH"
echo "    HOST_HOME=$HOST_HOME"
echo "    runners=$WITH_RUNNERS FIX_PROJECT_OWNERSHIP=$FIX_PROJECT_OWNERSHIP"
echo "    UI http://127.0.0.1:${DEV_TEAM_DASHBOARD_PORT}/"

"${COMPOSE[@]}" up -d --build

echo "==> status"
"${COMPOSE[@]}" ps
