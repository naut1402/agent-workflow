#!/usr/bin/env bash
# Sync ref gốc của một dòng branch vào mọi branch `<ns>/**/main` của dòng đó.
#
#   SRC_REF=main       TARGET_NS=dev   → main      → dev/x.y.z/main  (+ extra_targets)
#   SRC_REF=test/main  TARGET_NS=test  → test/main → test/x.y.z/main
#
# Sync THEO CẶP thì khai target tường minh, không discover theo namespace:
#
#   SRC_REF=dev/1.1.4/main  TARGETS_OVERRIDE=test/1.1.4/main
#
# Cần chế độ này vì dòng test mang cây đầy của dòng source: quan hệ là 1–1 theo
# version (`dev/x.y.z/main` ↔ `test/x.y.z/main`), không phải một gốc toả ra
# nhiều target. Discover theo namespace ở đây sẽ merge dòng version này vào dòng
# test của version KHÁC.
#
# Chạy trong GitHub Actions (cần git fetch-depth:0, GH_TOKEN, gh CLI).
#
# ⚠️ `EXTRA_FILE` chỉ có nghĩa với dòng source: script merge `SRC_REF` **vào**
# target, nên khai dòng test vào `auto-merge-targets.yml` là nhập cả cây source
# vào cây orphan của dòng test. Dòng test truyền `EXTRA_FILE=""` để tắt hẳn.
set -euo pipefail

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"

SRC_REF="${SRC_REF:-main}"
TARGET_NS="${TARGET_NS:-dev}"
# Danh sách target tường minh (cách nhau bởi space/newline). Khai thì BỎ HẲN
# bước discover — dùng `${VAR-}` để "khai rỗng" khác "chưa khai".
TARGETS_OVERRIDE="${TARGETS_OVERRIDE-}"
# Dùng `${VAR-default}` (không phải `:-`) để phân biệt "chưa khai" với "khai rỗng".
EXTRA_FILE="${EXTRA_FILE-.github/auto-merge-targets.yml}"

# Đảm bảo có đủ remote refs (checkout có thể chưa fetch hết pattern dev/** hoặc test/**).
git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'

{
  echo "## Sync ${SRC_REF} → ${TARGET_NS}/**/main"
  echo ""
  echo "| Target | Result | Note |"
  echo "| --- | --- | --- |"
} >> "$SUMMARY"

EXTRA_TARGETS=()
if [[ -n "$TARGETS_OVERRIDE" ]]; then
  # Target tường minh: 🚫 không đọc `EXTRA_FILE`, 🚫 không discover. Sai target ở
  # chế độ này là merge sai cây, nên thà không có target còn hơn đoán thêm.
  read -r -a EXTRA_TARGETS <<< "$TARGETS_OVERRIDE"
  EXTRA_FILE=''
elif [[ -n "$EXTRA_FILE" && -f "$EXTRA_FILE" ]]; then
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

# ⚠️ Với TARGET_NS=test, for-each-ref trả về **cả** `test/main` — vòng lọc dưới
# loại `SRC_REF` ra, thiếu bước đó là script tự merge SRC_REF vào chính nó.
LINE_MAINS=()
if [[ -z "$TARGETS_OVERRIDE" ]]; then
  mapfile -t LINE_MAINS < <(
    git for-each-ref --format='%(refname:short)' "refs/remotes/origin/${TARGET_NS}" \
      | sed 's#^origin/##' \
      | grep '/main$' \
      | sort -u || true
  )
fi

declare -A SEEN=()
TARGETS=()
for t in "${LINE_MAINS[@]+"${LINE_MAINS[@]}"}" "${EXTRA_TARGETS[@]+"${EXTRA_TARGETS[@]}"}"; do
  [[ -z "${t:-}" || "$t" == "$SRC_REF" || "$t" == "main" ]] && continue
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

  if git merge-base --is-ancestor "origin/${SRC_REF}" "origin/${target}"; then
    echo "| \`${target}\` | skipped | Đã chứa origin/${SRC_REF} |" >> "$SUMMARY"
    echo "Up-to-date — skip."
    echo "::endgroup::"
    continue
  fi

  git checkout -B "$target" "origin/${target}"

  if git merge --no-ff "origin/${SRC_REF}" -m "chore: sync ${SRC_REF} into ${target}"; then
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
      --base "$target" --head "$SRC_REF" --state open \
      --json number --jq '.[0].number // empty')"

    if [[ -n "$EXISTING" ]]; then
      gh pr edit "$EXISTING" --repo "$REPO" --add-label auto-merge-conflict || true
      echo "| \`${target}\` | conflict-PR | Reuse #${EXISTING} |" >> "$SUMMARY"
    else
      BODY="$(cat <<EOF
## Sync conflict

Tự động sync \`${SRC_REF}\` → \`${target}\` bị **conflict**.

Resolve conflict trên PR này rồi merge để tiếp tục đồng bộ.

Script: \`.github/scripts/sync-line.sh\`
EOF
)"
      if PR_URL="$(gh pr create --repo "$REPO" \
        --base "$target" \
        --head "$SRC_REF" \
        --title "chore: sync ${SRC_REF} into ${target}" \
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
