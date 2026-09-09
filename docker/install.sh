#!/usr/bin/env bash
# Deploy helper.
# Usage: ./docker/install.sh [--runners] [--build] [--port=N] [--down]
# Reads docker/.env (--env-file). Creates from .env.example if missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Absolute for shell file I/O; relative for docker.exe (avoids Git Bash/MSYS
# turning /c/Users/... into C:\c\Users\...).
ENV_FILE="$ROOT/docker/.env"
ENV_FILE_DOCKER="docker/.env"
ENV_EXAMPLE="$ROOT/docker/.env.example"
IMAGE_NAME="dev-team-dashboard:local"

WITH_RUNNERS=0
DO_DOWN=0
DO_BUILD=0
CLI_PORT=

usage() {
  cat <<'EOF'
Usage: ./docker/install.sh [options]

  --runners, -r     Mount host Claude/Cursor auth (compose.runners.yml)
  --build, -b       Rebuild image (Dockerfile / deps / corporate CA)
  --port=N, -p N    Host publish port (persists to docker/.env)
  --down            docker compose down
  -h, --help        Show this help

Default is up -d without rebuild. Image is built automatically if missing.
PORT: set DEV_TEAM_DASHBOARD_PORT in docker/.env or pass --port=N
      (host port only; container always listens on 5174).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --runners|-r) WITH_RUNNERS=1; shift ;;
    --build|-b) DO_BUILD=1; shift ;;
    --down) DO_DOWN=1; shift ;;
    --port=*)
      CLI_PORT="${1#--port=}"
      shift
      ;;
    --port|-p)
      if [ $# -lt 2 ]; then
        echo "!! $1 needs a port number" >&2
        exit 1
      fi
      CLI_PORT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (try --help)" >&2
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

persist_env_key() {
  local key="$1" val="$2" tmp
  tmp="${ENV_FILE}.tmp"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

if [ -n "$CLI_PORT" ]; then
  case "$CLI_PORT" in
    ''|*[!0-9]*)
      echo "!! invalid port: $CLI_PORT" >&2
      exit 1
      ;;
  esac
  if [ "$CLI_PORT" -lt 1 ] || [ "$CLI_PORT" -gt 65535 ]; then
    echo "!! port out of range: $CLI_PORT" >&2
    exit 1
  fi
  export DEV_TEAM_DASHBOARD_PORT="$CLI_PORT"
  persist_env_key DEV_TEAM_DASHBOARD_PORT "$CLI_PORT"
  echo "==> DEV_TEAM_DASHBOARD_PORT=$CLI_PORT (saved to $ENV_FILE_DOCKER)"
fi

# Normalize Windows / Git-Bash / MSYS paths to a filesystem path this shell can open.
normalize_host_path() {
  local p="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$p" 2>/dev/null || printf '%s' "$p"
    return 0
  fi
  case "$p" in
    [A-Za-z]:[\\/]*|[A-Za-z]:\\*)
      local drive rest
      drive=$(printf '%s' "${p%"${p#?}"}" | tr '[:upper:]' '[:lower:]')
      rest="${p:2}"
      rest="${rest//\\//}"
      printf '/%s/%s' "$drive" "$rest"
      ;;
    *)
      printf '%s' "$p"
      ;;
  esac
}

# If host has NODE_EXTRA_CA_CERTS / SSL_CERT_FILE / …, stage into docker/certs/
# and write manifest.env with basenames only (COPY'd into the image).
# Avoid passing absolute /etc/... paths as Docker build-args: Git Bash/MSYS
# converts them to C:/Program Files/Git/etc/... and breaks the Linux build.
stage_corp_ca_from_host() {
  local dest="$ROOT/docker/certs"
  local manifest="$dest/manifest.env"
  local var host_val norm base staged=0
  mkdir -p "$dest"
  # Drop previously staged certs/manifest; keep placeholders.
  find "$dest" -maxdepth 1 -type f \
    ! -name '.gitkeep' ! -name 'README.md' ! -name 'README' \
    -delete 2>/dev/null || true

  : > "$manifest"

  for var in NODE_EXTRA_CA_CERTS SSL_CERT_FILE REQUESTS_CA_BUNDLE CURL_CA_BUNDLE; do
    host_val="${!var:-}"
    [ -n "$host_val" ] || continue
    norm="$(normalize_host_path "$host_val")"
    if [ ! -f "$norm" ]; then
      echo "!! WARNING: $var points to missing file: $host_val" >&2
      continue
    fi
    base="$(basename "$norm")"
    # Basename only, safe charset — consumer must not treat this as shell.
    case "$base" in
      ''|.*|*/*|*\\*|*"'"*|*'\"'*|*$'\n'*|*[!A-Za-z0-9._-]*)
        echo "!! WARNING: $var basename unsafe, skip: $base" >&2
        continue
        ;;
    esac
    cp "$norm" "$dest/$base"
    printf '%s=%s\n' "$var" "$base" >> "$manifest"
    echo "    staged $var → $base (/etc/ssl/corp-ca/$base)"
    staged=1
  done

  if [ "$staged" -eq 1 ]; then
    echo "==> corporate CA: staged for image build (via docker/certs/manifest.env)"
  else
    rm -f "$manifest"
    echo "==> corporate CA: none (host env unset or files missing)"
  fi
}

stage_cursor_cli_auth() {
  local runtime="$ROOT/docker/.runtime"
  local stage="$runtime/cursor-auth.json"
  local cand found=""
  mkdir -p "$runtime"

  for cand in \
    "${HOST_HOME:+$HOST_HOME/.cursor/auth.json}" \
    "${XDG_CONFIG_HOME:-${HOME}/.config}/cursor/auth.json" \
    "${APPDATA:+$(normalize_host_path "$APPDATA/Cursor/auth.json")}" \
    "${USERPROFILE:+$(normalize_host_path "$USERPROFILE/AppData/Roaming/Cursor/auth.json")}" \
    "$(normalize_host_path "C:/Users/$(id -un)/AppData/Roaming/Cursor/auth.json")"
  do
    [ -n "$cand" ] || continue
    if [ -f "$cand" ] && grep -q accessToken "$cand" 2>/dev/null; then
      found="$cand"
      break
    fi
  done

  if [ -n "$found" ]; then
    cp "$found" "$stage"
    chmod 600 "$stage" 2>/dev/null || true
    echo "==> staged Cursor CLI auth from $found"
  else
    printf '{}\n' > "$stage"
    if [ -z "${CURSOR_API_KEY:-}" ]; then
      echo "!! WARNING: Cursor CLI auth not found (expected Windows %%APPDATA%%\\Cursor\\auth.json or ~/.cursor/auth.json)." >&2
      echo "   Set CURSOR_API_KEY in docker/.env, or run: agent login" >&2
    fi
  fi
}

if [ "$PUID" = "0" ] || [ "$PGID" = "0" ]; then
  echo "!! WARNING: PUID/PGID=0" >&2
fi

COMPOSE=(docker compose --env-file "$ENV_FILE_DOCKER" -f docker/compose.yml)
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

  stage_cursor_cli_auth
fi

if [ "$DO_BUILD" -eq 0 ] && ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "==> image $IMAGE_NAME missing — enabling --build"
  DO_BUILD=1
fi

if [ "$DO_BUILD" -eq 1 ]; then
  stage_corp_ca_from_host
fi

echo "==> deploy (env-file=$ENV_FILE_DOCKER)"
echo "    PUID=$PUID PGID=$PGID"
echo "    DEV_TEAM_PROJECT_PATH=$DEV_TEAM_PROJECT_PATH"
echo "    HOST_HOME=$HOST_HOME"
echo "    runners=$WITH_RUNNERS build=$DO_BUILD FIX_PROJECT_OWNERSHIP=$FIX_PROJECT_OWNERSHIP"
echo "    UI http://127.0.0.1:${DEV_TEAM_DASHBOARD_PORT}/"

if [ "$DO_BUILD" -eq 1 ]; then
  "${COMPOSE[@]}" up -d --build
else
  "${COMPOSE[@]}" up -d
fi

echo "==> status"
"${COMPOSE[@]}" ps
