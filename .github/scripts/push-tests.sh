#!/usr/bin/env bash
# Đẩy cây test đang có trong working tree (`tests/` + `test-e2e/`) lên một branch
# của **dòng test**, mà không phải rời worktree dòng source đang làm việc.
#
#   bun run test:push test/1.1.4/T0000abcd_ten-task "test(monitor): phủ TC-01…TC-07"
#
# Vì sao cần script này: bước viết test chạy trên worktree **dòng source** (ở đó
# mới có `package.json`, config runner và dependency để chạy được suite), nhưng
# commit lại phải nằm ở dòng test. Không có script thì template agent phải mô tả
# 6–8 dòng thao tác worktree, và đó là chỗ sai nhiều nhất.
#
# 🚫 KHÔNG chạy từ chính cây orphan của dòng test: ở đó không có `package.json`
# nên `bun run` không có script nào để gọi.
set -euo pipefail

TEST_BRANCH="${1:-}"
MESSAGE="${2:-}"
if [[ -z "$TEST_BRANCH" || -z "$MESSAGE" ]]; then
  echo 'Cách dùng: bun run test:push <test/x.y.z/{taskID}_{slug}> "<commit message>"' >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ ! -f package.json ]]; then
  echo "Không thấy package.json — đang đứng trên cây orphan của dòng test." >&2
  echo "Chạy lệnh này từ worktree dòng source (nơi đã overlay và chạy được suite)." >&2
  exit 1
fi
if [[ "$TEST_BRANCH" != test/* || "$TEST_BRANCH" == */main ]]; then
  echo "\"$TEST_BRANCH\" không phải branch task dòng test — dạng đúng: test/x.y.z/{taskID}_{slug}" >&2
  exit 1
fi
[[ -d tests ]] || { echo "Không thấy tests/ — chưa overlay hoặc chưa viết test nào." >&2; exit 1; }

VERSION="$(bun .github/scripts/test-ref.ts version "$TEST_BRANCH")"
[[ "$VERSION" != 'main' ]] || { echo "Không suy được version từ \"$TEST_BRANCH\"." >&2; exit 1; }
TEST_LINE="test/${VERSION}/main"

# Branch task đã có thì đẩy tiếp lên nó; chưa có thì cắt từ dòng test của version.
if git ls-remote --exit-code origin "refs/heads/${TEST_BRANCH}" >/dev/null 2>&1; then
  REMOTE_REF="$TEST_BRANCH"
elif git ls-remote --exit-code origin "refs/heads/${TEST_LINE}" >/dev/null 2>&1; then
  REMOTE_REF="$TEST_LINE"
else
  echo "Dòng test ${TEST_LINE} chưa tồn tại — mở dòng test của version trước:" >&2
  echo "  git push origin refs/remotes/origin/test/main:refs/heads/${TEST_LINE}" >&2
  exit 1
fi
START="refs/remotes/origin/${REMOTE_REF}"
git fetch --no-tags --quiet origin "+refs/heads/${REMOTE_REF}:${START}"

WT="$(mktemp -d "${TMPDIR:-/tmp}/testline-XXXXXX")"
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# `-B` để chạy lại lần hai trên cùng branch task không vướng "branch đã tồn tại".
git worktree add --quiet --detach "$WT" "$START"
git -C "$WT" checkout --quiet -B "$TEST_BRANCH" "$START"

# Thay nguyên cây, không merge từng file: file test đã xoá ở local cũng phải biến
# mất ở dòng test, nếu không thì suite trên cây ghép chạy cả bản cũ.
rm -rf -- "${WT:?}/tests" "${WT:?}/test-e2e"
tar -c --exclude=.runtime --exclude=node_modules --exclude=coverage \
  -C "$ROOT" tests test-e2e | tar -x -C "$WT"

git -C "$WT" add tests test-e2e
if git -C "$WT" diff --cached --quiet; then
  echo "Cây test không khác ${TEST_BRANCH} — không có gì để đẩy."
  exit 0
fi

git -C "$WT" commit --quiet -m "$MESSAGE"
git -C "$WT" push --quiet -u origin "HEAD:refs/heads/${TEST_BRANCH}"

echo "Đã đẩy cây test lên ${TEST_BRANCH} @ $(git -C "$WT" rev-parse --short HEAD)"
echo "Mở PR: base ${TEST_LINE} ← ${TEST_BRANCH} (template ?template=test.md)"
