#!/usr/bin/env bash
# Ghép cây test của dòng test vào cây làm việc hiện tại (`tests/` + `test-e2e/`
# ngay gốc repo — đúng chỗ cây tracked cũ, để relative import / alias `@/…` /
# shim khai trong config gốc resolve không đổi).
#
#   bun run test:overlay                      # suy ref test từ branch đang đứng
#   bun run test:overlay test/1.1.4/main      # ép ref cụ thể
#   FORCE=1 bun run test:overlay              # ghi đè cả khi cây test đang bẩn
#
# Idempotent: chạy lại là ghi đè, không cộng dồn — file đã xoá ở ref mới cũng
# biến mất ở local.
#
# 🚫 KHÔNG symlink: vite/vitest resolve qua realpath, symlink ra ngoài gốc repo
# làm alias và shim vỡ.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

TEST_REF="${1:-}"
if [[ -z "$TEST_REF" ]]; then
  CURRENT="$(git branch --show-current)"
  if [[ -z "$CURRENT" ]]; then
    echo "Đang ở detached HEAD — truyền ref test tường minh: bun run test:overlay test/x.y.z/main" >&2
    exit 1
  fi
  # Đứng trên chính dòng test thì lấy luôn branch đó, không suy chéo.
  if [[ "$CURRENT" == test/* ]]; then
    TEST_REF="$CURRENT"
  else
    TEST_REF="$(bun .github/scripts/test-ref.ts test "$CURRENT")"
  fi
fi

echo "Overlay cây test từ ref: $TEST_REF"

if ! git fetch --no-tags --depth=1 origin "+refs/heads/${TEST_REF}:refs/remotes/origin/${TEST_REF}"; then
  echo "Không fetch được refs/heads/${TEST_REF} từ origin." >&2
  echo "  - Dòng test của version này chưa tồn tại → tạo: git switch -c ${TEST_REF} origin/test/main" >&2
  echo "  - Hoặc máy không có mạng tới remote → đây KHÔNG phải 'test đỏ', là 'chưa kéo được dòng test'." >&2
  exit 1
fi

# Chốt an toàn cho giai đoạn đệm: `tests/` còn **tracked** trên dòng source, nên
# dev đang sửa dở một test mà chạy lệnh này là mất trắng thay đổi chưa commit.
# Cảnh báo trong comment thì không ai đọc lúc chạy — chặn hẳn, cho phép ép.
if git ls-files --error-unmatch tests >/dev/null 2>&1; then
  DIRTY="$(git status --porcelain -- tests test-e2e)"
  if [[ -n "$DIRTY" && -z "${FORCE:-}" ]]; then
    echo "tests/ · test-e2e/ đang có thay đổi chưa commit — overlay sẽ xoá sạch:" >&2
    echo "$DIRTY" >&2
    echo "Commit/stash trước, hoặc chạy lại với FORCE=1 nếu chấp nhận mất." >&2
    exit 1
  fi
fi

# Dọn trước khi extract: giai đoạn đệm cây source vẫn còn `tests/`, và runner CI
# có thể tái dùng workspace — sót file của lần trước là suite chạy sai.
# ⚠️ Trước Đợt 5, `tests/` còn tracked trên dòng source nên sau lệnh này
# `git status` sẽ báo cây test đổi. Đó là cây overlay, KHÔNG commit vào dòng source.
rm -rf -- "${ROOT}/tests" "${ROOT}/test-e2e"
git archive "origin/${TEST_REF}" tests test-e2e | tar -x -C .

echo "Đã overlay ${TEST_REF} vào tests/ + test-e2e/. Chạy: bun run test:all"
