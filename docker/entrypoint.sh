#!/bin/sh
# Drop root before starting the dashboard so Claude CLI can use
# --dangerously-skip-permissions (blocked for uid 0).
#
# Ownership (LinuxServer-style):
#   PUID / PGID → chạy process trùng uid/gid sở hữu project trên host
#                 (không chown /data/project). Khuyến nghị.
#   FIX_PROJECT_OWNERSHIP=1 → chown -R /data/project (đổi owner trên host — last resort).
#
# Compat: HOST_UID / HOST_GID vẫn được đọc nếu PUID/PGID trống.
set -e

RUN_UID="${PUID:-${HOST_UID:-1001}}"
RUN_GID="${PGID:-${HOST_GID:-1001}}"

resolve_run_user() {
  if getent passwd "$RUN_UID" >/dev/null 2>&1; then
    RUN_NAME=$(getent passwd "$RUN_UID" | cut -d: -f1)
    return 0
  fi
  RUN_NAME=abc
  if ! getent group "$RUN_GID" >/dev/null 2>&1; then
    groupadd -g "$RUN_GID" abc 2>/dev/null || true
  fi
  useradd -u "$RUN_UID" -g "$RUN_GID" -d /home/dashboard -M -s /bin/bash "$RUN_NAME" 2>/dev/null \
    || useradd -u "$RUN_UID" -d /home/dashboard -M -s /bin/bash "$RUN_NAME" 2>/dev/null \
    || true
  if getent passwd "$RUN_UID" >/dev/null 2>&1; then
    RUN_NAME=$(getent passwd "$RUN_UID" | cut -d: -f1)
  else
    RUN_NAME=dashboard
    RUN_UID=1001
    RUN_GID=1001
  fi
}

own() {
  chown -R "$RUN_UID:$RUN_GID" "$@" 2>/dev/null || true
}

mkdir -p /data/dashboard-home /home/dashboard/.claude /home/dashboard/.cursor
resolve_run_user

own /data/dashboard-home /home/dashboard
chown "$RUN_UID:$RUN_GID" /data/dashboard-home/credentials.json 2>/dev/null || true
own /app

# ── Writable `.dev-team-agent` on bind mounts ─────────────────────────────────
fix_dev_team_root() {
  target="$1"
  [ -n "$target" ] || return 0
  mkdir -p \
    "$target" \
    "$target/custom-agents" \
    "$target/agent-templates" \
    "$target/workflow-step-templates" \
    "$target/pipeline-profiles" \
    "$target/tasks" \
    "$target/knowledge/project" \
    "$target/knowledge/system" \
    "$target/.dev-state" \
    2>/dev/null || true
  # Prefer mkdir as PUID when possible (tránh chown thừa).
  if runuser -u "$RUN_NAME" -- test -w "$target" 2>/dev/null; then
    runuser -u "$RUN_NAME" -- mkdir -p \
      "$target/custom-agents" \
      "$target/agent-templates" \
      "$target/workflow-step-templates" \
      "$target/pipeline-profiles" \
      "$target/tasks" \
      "$target/knowledge/project" \
      "$target/knowledge/system" \
      "$target/.dev-state" \
      2>/dev/null || true
  else
    own "$target"
  fi
}

ensure_project_dev_team_writable() {
  if [ -n "${DEV_TEAM_ROOT:-}" ]; then
    fix_dev_team_root "$DEV_TEAM_ROOT"
  fi

  if [ -d /data/project ]; then
    find /data/project -maxdepth 3 -type d -name '.dev-team-agent' 2>/dev/null \
      | while IFS= read -r d; do
          fix_dev_team_root "$d"
        done
  fi
}

fix_project_tree_writable() {
  case "${FIX_PROJECT_OWNERSHIP:-0}" in
    1|true|TRUE|yes|YES) ;;
    *) return 0 ;;
  esac
  if [ ! -d /data/project ]; then
    return 0
  fi
  echo "[dev-team-dashboard] WARNING: FIX_PROJECT_OWNERSHIP=1 → chown -R ${RUN_UID}:${RUN_GID} /data/project (host bind ownership changes)"
  chown -R "$RUN_UID:$RUN_GID" /data/project 2>/dev/null || true
}

ensure_project_dev_team_writable
fix_project_tree_writable

seed_bundled_plugin() {
  src=/opt/bundled-plugins/dev-agent-teams
  dest_root=/home/dashboard/.claude/plugins/cache/bundled/dev-agent-teams/0.0.0
  if [ ! -d "$src/agents" ]; then
    return 0
  fi
  if [ -e /home/dashboard/.claude/plugins/cache ] \
    && find /home/dashboard/.claude/plugins/cache -path '*/dev-agent-teams/*/agents/investigator.md' 2>/dev/null | grep -q .
  then
    return 0
  fi
  mkdir -p "$dest_root" 2>/dev/null || return 0
  cp -a "$src/." "$dest_root/" 2>/dev/null || return 0
  own /home/dashboard/.claude/plugins
}

sync_claude_auth() {
  host_dir=/mnt/host-claude
  host_json=/mnt/host-claude.json
  dest_dir=/home/dashboard/.claude

  mkdir -p "$dest_dir"

  for name in .credentials.json credentials.json; do
    if [ -f "$host_dir/$name" ]; then
      cp "$host_dir/$name" "$dest_dir/$name"
      if [ "$name" = "credentials.json" ] && [ ! -f "$dest_dir/.credentials.json" ]; then
        cp "$host_dir/$name" "$dest_dir/.credentials.json"
      fi
    fi
  done

  if [ -f "$host_json" ]; then
    cp "$host_json" /home/dashboard/.claude.json
  fi

  if [ -d "$host_dir/plugins" ]; then
    rm -rf "$dest_dir/plugins"
    ln -s "$host_dir/plugins" "$dest_dir/plugins"
  fi

  if [ -f "$host_dir/settings.json" ]; then
    cp "$host_dir/settings.json" "$dest_dir/settings.json"
  fi

  own "$dest_dir" /home/dashboard/.claude.json
  chmod 600 "$dest_dir/.credentials.json" 2>/dev/null || true
  chmod 600 "$dest_dir/credentials.json" 2>/dev/null || true
  chmod 600 /home/dashboard/.claude.json 2>/dev/null || true
}

sync_cursor_auth() {
  host_dir=/mnt/host-cursor
  dest_dir=/home/dashboard/.cursor
  if [ ! -d "$host_dir" ]; then
    return 0
  fi
  mkdir -p "$dest_dir"
  for f in "$host_dir"/* "$host_dir"/.[!.]*; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    case "$base" in
      projects|ai-tracking|extensions) continue ;;
    esac
    if [ -f "$f" ]; then
      cp "$f" "$dest_dir/$base" 2>/dev/null || true
    elif [ -d "$f" ]; then
      rm -rf "$dest_dir/$base"
      ln -s "$f" "$dest_dir/$base" 2>/dev/null || true
    fi
  done
  own "$dest_dir"
}

if [ -d /mnt/host-claude ]; then
  sync_claude_auth
fi
if [ -d /mnt/host-cursor ]; then
  sync_cursor_auth
fi

seed_bundled_plugin

export HOME=/home/dashboard
export USER="$RUN_NAME"
export CLAUDE_CONFIG_DIR=/home/dashboard/.claude
export PATH="/home/dashboard/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if command -v git >/dev/null 2>&1; then
  git config --global --add safe.directory '*' 2>/dev/null || true
  if [ -f /root/.gitconfig ]; then
    cp /root/.gitconfig /home/dashboard/.gitconfig 2>/dev/null || true
    own /home/dashboard/.gitconfig
  fi
fi

echo "[dev-team-dashboard] drop privileges → uid=${RUN_UID} gid=${RUN_GID} user=${RUN_NAME} PUID=${PUID:-} PGID=${PGID:-} FIX_PROJECT_OWNERSHIP=${FIX_PROJECT_OWNERSHIP:-0}"

if [ "$(id -u)" = "0" ]; then
  exec runuser -u "$RUN_NAME" -- env \
    HOME="$HOME" \
    USER="$USER" \
    CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" \
    PATH="$PATH" \
    "$@"
fi

exec "$@"
