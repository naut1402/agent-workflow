/**
 * Phân runner theo path — **một** nguồn sự thật cho cả `run-bun-tests.ts` (CI +
 * local) và `test-scope.ts` (chọn phạm vi). Danh sách sống ở `tests/runners.json`,
 * tức là ở **dòng test**, không ở `package.json`: sau khi cắt `tests/` khỏi dòng
 * source thì thêm/bớt thư mục test không còn phải sửa file nào ở dòng source.
 */
import fs from 'node:fs'
import path from 'node:path'

export const RUNNERS_FILE = 'tests/runners.json'

export interface Runners {
  /** Path list mà `bun test` sở hữu; phần còn lại dưới `tests/src/**` là vitest. */
  bunTest: string[]
}

/** Đọc `tests/runners.json`; thiếu file ⇒ cây test chưa được ghép, không phải "không có test". */
export function readRunners(root: string): Runners {
  const file = path.join(root, RUNNERS_FILE)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    throw new Error(`Không thấy ${RUNNERS_FILE} — chưa overlay cây test. Chạy \`bun run test:overlay\` rồi thử lại.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${RUNNERS_FILE} không phải JSON hợp lệ: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }

  const bunTest = (parsed as Runners | null)?.bunTest
  if (!Array.isArray(bunTest) || bunTest.some((p) => typeof p !== 'string' || !p)) {
    throw new Error(`${RUNNERS_FILE} thiếu khoá "bunTest" dạng string[] — sửa file ở dòng test.`)
  }
  // Rỗng phải là lỗi: `bun test` không path sẽ quét **toàn bộ** repo và chạy cả
  // file test thuộc runner khác. Đúng cái bất biến "rỗng là đỏ, không phải xanh".
  if (bunTest.length === 0) {
    throw new Error(`${RUNNERS_FILE} có "bunTest" rỗng — khai ít nhất một path, hoặc xoá hẳn file nếu dòng test chưa có suite bun.`)
  }

  return { bunTest: bunTest.map((p) => p.replace(/\/+$/, '')) }
}
