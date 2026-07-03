#!/usr/bin/env bash
# Stub SSH for CI — logs argv to SSH_STUB_LOG; succeeds when remote cmd contains "echo ok" or "claude"
set -euo pipefail

if [[ -n "${SSH_STUB_LOG:-}" ]]; then
  printf '%s\n' "$*" >> "$SSH_STUB_LOG"
fi

remote_cmd="${*: -1}"
if [[ "$remote_cmd" == *"echo ok"* ]] || [[ "$remote_cmd" == *"claude"* ]]; then
  exit 0
fi

exit 1
