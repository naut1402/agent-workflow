#!/bin/sh
# Drop root before starting the dashboard so Claude CLI can use
# --dangerously-skip-permissions (blocked for uid 0).
set -e

mkdir -p /data/dashboard-home /home/dashboard/.claude /home/dashboard/.cursor

chown -R dashboard:dashboard /data/dashboard-home 2>/dev/null || true
chown dashboard:dashboard /home/dashboard 2>/dev/null || true
chown dashboard:dashboard /data/dashboard-home/credentials.json 2>/dev/null || true

# ── Claude / Cursor auth from host (ro mounts under /mnt) ──────────────────
# Official Claude Linux credential file is ~/.claude/.credentials.json (dot).
# Host files are often mode 0600 / other uid — copy into HOME so uid 1001 can
# read without chown'ing the host bind (which would break host `claude`).
sync_claude_auth() {
  host_dir=/mnt/host-claude
  host_json=/mnt/host-claude.json
  dest_dir=/home/dashboard/.claude

  mkdir -p "$dest_dir"

  for name in .credentials.json credentials.json; do
    if [ -f "$host_dir/$name" ]; then
      cp "$host_dir/$name" "$dest_dir/$name"
      # Always expose the canonical dotted name Claude looks for.
      if [ "$name" = "credentials.json" ] && [ ! -f "$dest_dir/.credentials.json" ]; then
        cp "$host_dir/$name" "$dest_dir/.credentials.json"
      fi
    fi
  done

  if [ -f "$host_json" ]; then
    cp "$host_json" /home/dashboard/.claude.json
  fi

  # Plugins cache (agents) — symlink into ro mount when possible.
  if [ -d "$host_dir/plugins" ]; then
    rm -rf "$dest_dir/plugins"
    ln -s "$host_dir/plugins" "$dest_dir/plugins"
  fi

  # Other useful dirs (settings) — best-effort copy of settings.json only.
  if [ -f "$host_dir/settings.json" ]; then
    cp "$host_dir/settings.json" "$dest_dir/settings.json"
  fi

  chown -R dashboard:dashboard "$dest_dir" /home/dashboard/.claude.json 2>/dev/null || true
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
  # Shallow copy of top-level files; skip huge caches if any.
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
  chown -R dashboard:dashboard "$dest_dir" 2>/dev/null || true
}

if [ -d /mnt/host-claude ]; then
  sync_claude_auth
fi
if [ -d /mnt/host-cursor ]; then
  sync_cursor_auth
fi

export HOME=/home/dashboard
export USER=dashboard
export CLAUDE_CONFIG_DIR=/home/dashboard/.claude
export PATH="/home/dashboard/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [ "$(id -u)" = "0" ]; then
  exec runuser -u dashboard -- env \
    HOME="$HOME" \
    USER="$USER" \
    CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" \
    PATH="$PATH" \
    "$@"
fi

exec "$@"
