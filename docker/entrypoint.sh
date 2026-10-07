#!/bin/sh
# Drop root before starting the dashboard so Claude CLI can use
# --dangerously-skip-permissions (blocked for uid 0).
#
# Ownership (LinuxServer-style):
#   PUID / PGID → process uid/gid matching host project owner.
#   FIX_PROJECT_OWNERSHIP=1 → chown -R /data/project (last resort).
# Compat: HOST_UID / HOST_GID if PUID/PGID unset.
set -e

# Corporate CA exports (only non-empty paths; written at image build).
if [ -f /etc/ssl/corp-ca/env.sh ]; then
  # shellcheck disable=SC1091
  . /etc/ssl/corp-ca/env.sh
fi

RUN_UID="${PUID:-${HOST_UID:-1001}}"
RUN_GID="${PGID:-${HOST_GID:-1001}}"

if [ "$RUN_UID" = "0" ] || [ "$RUN_GID" = "0" ]; then
  echo "[dev-team-dashboard] WARNING: PUID/PGID=0 — fallback uid/gid 1001" >&2
  RUN_UID=1001
  RUN_GID=1001
fi

resolve_run_user() {
  if getent passwd "$RUN_UID" >/dev/null 2>&1; then
    RUN_NAME=$(getent passwd "$RUN_UID" | cut -d: -f1)
    if [ "$RUN_NAME" = "root" ] || [ "$RUN_UID" = "0" ]; then
      RUN_NAME=dashboard
      RUN_UID=1001
      RUN_GID=1001
    fi
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

# Chỉ chown entry sai owner — chown -R chạm mọi inode → overlayfs copy-up cả cây mỗi lần start.
# -h có chủ đích: không deref symlink ra ngoài cây (vd ~/.claude/plugins → mount host :ro).
own() {
  for own_target in "$@"; do
    [ -e "$own_target" ] || continue
    find "$own_target" \( ! -user "$RUN_UID" -o ! -group "$RUN_GID" \) \
      -exec chown -h "$RUN_UID:$RUN_GID" {} + 2>/dev/null || true
  done
}

mkdir -p /data/dashboard-home /home/dashboard/.claude /home/dashboard/.cursor
resolve_run_user

own /data/dashboard-home /home/dashboard
chown "$RUN_UID:$RUN_GID" /data/dashboard-home/credentials.json 2>/dev/null || true
own /app

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
  echo "[dev-team-dashboard] WARNING: FIX_PROJECT_OWNERSHIP=1 → chown -R ${RUN_UID}:${RUN_GID} /data/project"
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

ensure_claude_json() {
  dest_dir=/home/dashboard/.claude
  dest_cfg="$dest_dir/.claude.json"
  home_cfg=/home/dashboard/.claude.json
  mkdir -p "$dest_dir/backups"

  if [ -f "$dest_cfg" ]; then
    :
  elif [ -f "$home_cfg" ]; then
    cp "$home_cfg" "$dest_cfg"
  else
    latest=$(ls -1t "$dest_dir"/backups/.claude.json.backup.* 2>/dev/null | head -n 1 || true)
    if [ -n "$latest" ] && [ -f "$latest" ]; then
      echo "[dev-team-dashboard] restore .claude.json ← $latest"
      cp "$latest" "$dest_cfg"
    else
      printf '%s\n' '{"hasCompletedOnboarding":true,"bypassPermissionsModeAccepted":true}' > "$dest_cfg"
    fi
  fi

  if [ -f "$dest_cfg" ] && [ ! -f "$home_cfg" ]; then
    cp "$dest_cfg" "$home_cfg"
  fi
  own "$dest_cfg" "$home_cfg"
  chmod 600 "$dest_cfg" 2>/dev/null || true
  chmod 600 "$home_cfg" 2>/dev/null || true
}

sync_claude_auth() {
  host_dir=/mnt/host-claude
  host_json=/mnt/host-claude.json
  dest_dir=/home/dashboard/.claude
  synced_cred=0

  mkdir -p "$dest_dir"

  for name in .credentials.json credentials.json; do
    src="$host_dir/$name"
    if [ -f "$src" ]; then
      if [ ! -r "$src" ]; then
        echo "[dev-team-dashboard] WARNING: unreadable $src" >&2
        continue
      fi
      if cp "$src" "$dest_dir/$name"; then
        synced_cred=1
        if [ "$name" = "credentials.json" ] && [ ! -f "$dest_dir/.credentials.json" ]; then
          cp "$src" "$dest_dir/.credentials.json"
        fi
      else
        echo "[dev-team-dashboard] WARNING: cp failed: $src" >&2
      fi
    fi
  done

  if [ "$synced_cred" = "0" ]; then
    echo "[dev-team-dashboard] WARNING: no .credentials.json under $host_dir" >&2
  fi

  if [ -f "$host_json" ]; then
    cp "$host_json" /home/dashboard/.claude.json
    cp "$host_json" "$dest_dir/.claude.json"
  elif [ -d "$host_json" ]; then
    echo "[dev-team-dashboard] WARNING: $host_json is a directory (host ~/.claude.json missing)" >&2
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
  chmod 600 "$dest_dir/.claude.json" 2>/dev/null || true
}

sync_cursor_auth() {
  host_dir=/mnt/host-cursor
  dest_dir=/home/dashboard/.cursor
  if [ ! -d "$host_dir" ]; then
    return 0
  fi
  mkdir -p "$dest_dir"
  # Bỏ symlink cũ trỏ sang mount :ro (restart container vẫn giữ volume/home).
  for link in "$dest_dir"/* "$dest_dir"/.[!.]*; do
    [ -L "$link" ] || continue
    target=$(readlink "$link" 2>/dev/null || true)
    case "$target" in
      "$host_dir"/*|"$host_dir") rm -f "$link" ;;
    esac
  done
  # Chỉ copy file từ mount :ro. Không symlink thư mục — Cursor CLI ghi
  # sandbox-policies/, chats/, … dưới ~/.cursor (EROFS nếu trỏ sang host ro).
  for f in "$host_dir"/* "$host_dir"/.[!.]*; do
    [ -e "$f" ] || continue
    [ -f "$f" ] || continue
    base=$(basename "$f")
    cp "$f" "$dest_dir/$base" 2>/dev/null || true
  done
  mkdir -p "$dest_dir/chats" "$dest_dir/projects" "$dest_dir/acp-sessions" \
    "$dest_dir/sandbox-policies"
  own "$dest_dir"
}

sync_cursor_cli_auth() {
  dest_dir=/home/dashboard/.config/cursor
  dest="$dest_dir/auth.json"
  mkdir -p "$dest_dir"
  src=""
  if [ -f /mnt/host-cursor-auth.json ] && [ -s /mnt/host-cursor-auth.json ] \
    && grep -q accessToken /mnt/host-cursor-auth.json 2>/dev/null; then
    src=/mnt/host-cursor-auth.json
  elif [ -f /home/dashboard/.cursor/auth.json ] \
    && grep -q accessToken /home/dashboard/.cursor/auth.json 2>/dev/null; then
    src=/home/dashboard/.cursor/auth.json
  fi
  if [ -n "$src" ]; then
    cp "$src" "$dest"
    chmod 600 "$dest"
    # Từ .config: mkdir -p ở trên tạo nó dưới root, sau khi `own /home/dashboard` đã chạy.
    own /home/dashboard/.config
    mkdir -p /home/dashboard/.cursor
    cp "$dest" /home/dashboard/.cursor/auth.json
    chmod 600 /home/dashboard/.cursor/auth.json
    own /home/dashboard/.cursor/auth.json
    echo "[dev-team-dashboard] synced Cursor CLI auth → $dest"
  elif [ -z "${CURSOR_API_KEY:-}" ]; then
    echo "[dev-team-dashboard] WARNING: Cursor CLI not authenticated — set CURSOR_API_KEY or mount host auth.json (agent login)" >&2
  fi
}

# rtk: đăng ký PreToolUse hook cho Claude Code CLI.
# PHẢI chạy sau sync_claude_auth — bước đó cp đè settings.json từ /mnt/host-claude.
# rtk merge additive (giữ hook sẵn có, ghi backup .bak) và idempotent, nên chạy mỗi start là an toàn.
# Đích patch: rtk v0.51.0 ưu tiên $CLAUDE_CONFIG_DIR, chỉ lùi về $HOME/.claude khi biến đó rỗng
# (đo bằng `rtk init --dry-run` — ngược với design.md §2.3 A2, xem evidence/f1-local-verify.md §4).
# Truyền tường minh để không phụ thuộc việc runuser có giữ env hay không. Giá trị luôn là hằng
# /home/dashboard/.claude vì CLAUDE_CONFIG_DIR được export vô điều kiện ngay trước lời gọi hàm này
# — trùng đúng giá trị mà `exec runuser` cuối file truyền cho tiến trình `claude`, nên rtk và claude
# luôn patch/đọc cùng một file.
setup_rtk() {
  if [ "${RTK_HOOK_ENABLED:-1}" != "1" ]; then
    echo "[dev-team-dashboard] rtk hook disabled (RTK_HOOK_ENABLED=${RTK_HOOK_ENABLED})"
    return 0
  fi
  if ! command -v rtk >/dev/null 2>&1; then
    echo "[dev-team-dashboard] WARNING: rtk not found in PATH — skip token compression hook" >&2
    return 0
  fi

  # Volume rtk-data do Docker tạo thuộc root:root; phải chown trước khi drop privileges.
  # mkdir phải guard: file đang `set -e`, mount :ro / bind nhầm kiểu / hết inode sẽ giết
  # entrypoint trước `exec` → container không start chỉ vì một tính năng phụ trợ.
  if ! mkdir -p /home/dashboard/.local/share/rtk 2>/dev/null; then
    echo "[dev-team-dashboard] WARNING: cannot create rtk data dir — skip token compression hook" >&2
    return 0
  fi
  own /home/dashboard/.local/share/rtk

  if runuser -u "$RUN_NAME" -- env \
      HOME=/home/dashboard \
      CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-/home/dashboard/.claude}" \
      PATH="$PATH" \
      RTK_TELEMETRY_DISABLED="${RTK_TELEMETRY_DISABLED:-1}" \
      rtk init --global --hook-only --auto-patch >/dev/null 2>&1
  then
    rtk_ver=$(runuser -u "$RUN_NAME" -- env HOME=/home/dashboard PATH="$PATH" \
      rtk --version 2>/dev/null || true)
    # exit 0 chỉ chứng minh lệnh chạy xong, không chứng minh entry nằm đúng file mà `claude`
    # sẽ đọc. TC-29 còn DEFERRED nên dòng log này là tín hiệu vận hành duy nhất — grep để nó
    # là bằng chứng thật, không phải suy đoán từ exit code.
    if grep -q 'rtk hook claude' \
      "${CLAUDE_CONFIG_DIR:-/home/dashboard/.claude}/settings.json" 2>/dev/null
    then
      echo "[dev-team-dashboard] rtk hook registered (${rtk_ver:-unknown})"
    else
      echo "[dev-team-dashboard] WARNING: rtk init exit 0 but no 'rtk hook claude' in settings.json" >&2
    fi
  else
    echo "[dev-team-dashboard] WARNING: rtk init failed — continuing without token compression" >&2
  fi
}

if [ -d /mnt/host-claude ]; then
  sync_claude_auth
else
  echo "[dev-team-dashboard] WARNING: /mnt/host-claude not mounted" >&2
fi
if [ -d /mnt/host-cursor ]; then
  sync_cursor_auth
fi
sync_cursor_cli_auth

ensure_claude_json
seed_bundled_plugin

export HOME=/home/dashboard
export USER="$RUN_NAME"
export CLAUDE_CONFIG_DIR=/home/dashboard/.claude
export PATH="/home/dashboard/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Không cột vào công tắc rtk: sync_cursor_cli_auth mkdir ~/.config dưới root nhưng chỉ chown
# trong nhánh tìm thấy Cursor auth, nên luồng không dùng Cursor để lại ~/.config thuộc root:root.
# ~/.cache cũng vậy (hook rtk cache kết quả version check ở đó). `own /home/dashboard` ở đầu file
# chạy trước sync_* nên không cứu được.
own /home/dashboard/.config /home/dashboard/.cache

# `|| true`: ép bất biến fail-open bằng cú pháp thay vì bằng kỷ luật đọc mã — thêm một lệnh
# có thể trả khác 0 vào cuối setup_rtk sẽ không bao giờ giết được entrypoint trước `exec`.
setup_rtk || true

if command -v git >/dev/null 2>&1; then
  # Only trust the mounted project — never wildcard every repo.
  git config --global --add safe.directory /data/project 2>/dev/null || true
  if [ -f /root/.gitconfig ]; then
    cp /root/.gitconfig /home/dashboard/.gitconfig 2>/dev/null || true
    own /home/dashboard/.gitconfig
  fi
fi

# Normalize GitHub token for gh + git (HTTPS push).
if [ -z "${GH_TOKEN:-}" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
  GH_TOKEN="$GITHUB_TOKEN"
fi
if [ -z "${GITHUB_TOKEN:-}" ] && [ -n "${GH_TOKEN:-}" ]; then
  GITHUB_TOKEN="$GH_TOKEN"
fi
export GH_TOKEN="${GH_TOKEN:-}"
export GITHUB_TOKEN="${GITHUB_TOKEN:-}"

if [ -n "$GH_TOKEN" ] && command -v gh >/dev/null 2>&1; then
  runuser -u "$RUN_NAME" -- env HOME="$HOME" GH_TOKEN="$GH_TOKEN" GITHUB_TOKEN="$GITHUB_TOKEN" \
    gh auth setup-git 2>/dev/null || true
elif [ -z "$GH_TOKEN" ]; then
  echo "[dev-team-dashboard] WARNING: GH_TOKEN/GITHUB_TOKEN unset — git push / gh pr may fail" >&2
fi

if [ "$RUN_UID" = "0" ] || [ "$RUN_NAME" = "root" ]; then
  echo "[dev-team-dashboard] FATAL: refuse uid 0" >&2
  exit 1
fi

echo "[dev-team-dashboard] drop privileges → uid=${RUN_UID} gid=${RUN_GID} user=${RUN_NAME} PUID=${PUID:-} PGID=${PGID:-} FIX_PROJECT_OWNERSHIP=${FIX_PROJECT_OWNERSHIP:-0}"

if [ "$(id -u)" = "0" ]; then
  if ! command -v runuser >/dev/null 2>&1; then
    echo "[dev-team-dashboard] FATAL: runuser not found" >&2
    exit 1
  fi
  exec runuser -u "$RUN_NAME" -- env \
    HOME="$HOME" \
    USER="$USER" \
    CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" \
    PATH="$PATH" \
    GH_TOKEN="$GH_TOKEN" \
    GITHUB_TOKEN="$GITHUB_TOKEN" \
    "$@"
fi

if [ "$(id -u)" = "0" ]; then
  echo "[dev-team-dashboard] FATAL: still root" >&2
  exit 1
fi

exec "$@"
