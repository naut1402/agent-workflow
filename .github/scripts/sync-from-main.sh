#!/usr/bin/env bash
# Sync origin/main vào mọi branch dev/**/main + extra_targets.
# Chạy trong GitHub Actions (cần git fetch-depth:0, GH_TOKEN, gh CLI).
set -euo pipefail

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"

# Đảm bảo có đủ remote refs (checkout có thể chưa fetch hết pattern dev/**).
git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'

{
  echo "## Sync main → version/epic mains"
  echo ""
  echo "| Target | Result | Note |"
  echo "| --- | --- | --- |"
} >> "$SUMMARY"

EXTRA_FILE=".github/auto-merge-targets.yml"
EXTRA_TARGETS=()
if [[ -f "$EXTRA_FILE" ]]; then
  mapfile -t EXTRA_TARGETS < <(python3 - "$EXTRA_FILE" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
in_section = False
for line in text.splitlines():
    raw = line.rstrip("\n")
    stripped = raw.strip()
    if stripped.startswith("#") or not stripped:
        continue
    if stripped.startswith("extra_targets:"):
        in_section = True
        rest = stripped.split(":", 1)[1].strip()
        if rest == "[]":
            break
        continue
    if in_section:
        if raw and raw[0] not in (" ", "\t") and not stripped.startswith("-"):
            break
        if stripped.startswith("#"):
            continue
        m = re.match(r"^-\s+(.+)$", stripped)
        if m:
            val = m.group(1).strip().strip("'\"")
            if val and not val.startswith("#"):
                print(val)
PY
  )
fi

mapfile -t DEV_MAINS < <(
  git for-each-ref --format='%(refname:short)' refs/remotes/origin/dev \
    | sed 's#^origin/##' \
    | grep '/main$' \
    | sort -u || true
)

declare -A SEEN=()
TARGETS=()
for t in "${DEV_MAINS[@]+"${DEV_MAINS[@]}"}" "${EXTRA_TARGETS[@]+"${EXTRA_TARGETS[@]}"}"; do
  [[ -z "${t:-}" || "$t" == "main" ]] && continue
  if [[ -z "${SEEN[$t]:-}" ]]; then
    SEEN[$t]=1
    TARGETS+=("$t")
  fi
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "| _(none)_ | skipped | Không có target |" >> "$SUMMARY"
  echo "Không có target để sync."
  exit 0
fi

echo "Targets: ${TARGETS[*]}"

FAIL=0
for target in "${TARGETS[@]}"; do
  echo "::group::Sync → ${target}"

  if ! git rev-parse --verify "origin/${target}" >/dev/null 2>&1; then
    echo "| \`${target}\` | missing | Branch không tồn tại trên origin |" >> "$SUMMARY"
    echo "Cảnh báo: origin/${target} không tồn tại — bỏ qua."
    echo "::endgroup::"
    continue
  fi

  if git merge-base --is-ancestor origin/main "origin/${target}"; then
    echo "| \`${target}\` | skipped | Đã chứa origin/main |" >> "$SUMMARY"
    echo "Up-to-date — skip."
    echo "::endgroup::"
    continue
  fi

  git checkout -B "$target" "origin/${target}"

  if git merge --no-ff origin/main -m "chore: sync main into ${target}"; then
    if git push origin "HEAD:${target}"; then
      echo "| \`${target}\` | synced | Pushed merge commit |" >> "$SUMMARY"
      echo "Synced OK."
    else
      echo "| \`${target}\` | failed | git push thất bại |" >> "$SUMMARY"
      echo "Push failed."
      FAIL=1
      git reset --hard "origin/${target}" || true
    fi
  else
    git merge --abort || true
    echo "Conflict — mở/reuse PR."

    EXISTING="$(gh pr list --repo "$REPO" \
      --base "$target" --head main --state open \
      --json number --jq '.[0].number // empty')"

    if [[ -n "$EXISTING" ]]; then
      gh pr edit "$EXISTING" --repo "$REPO" --add-label auto-merge-conflict || true
      echo "| \`${target}\` | conflict-PR | Reuse #${EXISTING} |" >> "$SUMMARY"
    else
      BODY="$(cat <<EOF
## Sync conflict

Tự động sync \`main\` → \`${target}\` bị **conflict**.

Resolve conflict trên PR này rồi merge để tiếp tục đồng bộ.

Workflow: \`sync-from-main.yml\`
EOF
)"
      if PR_URL="$(gh pr create --repo "$REPO" \
        --base "$target" \
        --head main \
        --title "chore: sync main into ${target}" \
        --label auto-merge-conflict \
        --body "$BODY")"; then
        echo "| \`${target}\` | conflict-PR | ${PR_URL} |" >> "$SUMMARY"
      else
        echo "| \`${target}\` | failed | Conflict và không tạo được PR |" >> "$SUMMARY"
        FAIL=1
      fi
    fi
  fi

  echo "::endgroup::"
done

exit "$FAIL"
