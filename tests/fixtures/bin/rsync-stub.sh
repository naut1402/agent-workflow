#!/usr/bin/env bash
# Stub rsync — copies remote spec locally without network for tests
set -euo pipefail

if [[ "${RSYNC_STUB_MODE:-}" == "fail" ]]; then
  exit 1
fi

if [[ -n "${RSYNC_STUB_LOG:-}" ]]; then
  printf '%s\n' "$*" >> "$RSYNC_STUB_LOG"
fi

# Find last two non-flag args as src and dest
args=("$@")
src=""
dest=""
for ((i=${#args[@]}-1; i>=0; i--)); do
  a="${args[i]}"
  [[ "$a" == -* ]] && continue
  if [[ -z "$dest" ]]; then
    dest="$a"
  elif [[ -z "$src" ]]; then
    src="$a"
    break
  fi
done

if [[ -z "$src" || -z "$dest" ]]; then
  exit 1
fi

# Parse user@host:/path
remote_path="$src"
if [[ "$src" == *:* ]]; then
  remote_path="${src#*:}"
fi

fixture_root="${RSYNC_STUB_FIXTURE:-}"
if [[ -n "$fixture_root" && "$remote_path" == /* ]]; then
  rel="${remote_path#/}"
  src_local="$fixture_root/$rel"
  if [[ -e "$src_local" ]]; then
    mkdir -p "$(dirname "$dest")"
    if [[ -d "$src_local" ]]; then
      mkdir -p "$dest"
      cp -a "$src_local/." "$dest/" 2>/dev/null || true
    else
      cp -a "$src_local" "$dest" 2>/dev/null || true
    fi
    exit 0
  fi
fi

# Fallback: create empty dest dir
mkdir -p "$dest"
exit 0
