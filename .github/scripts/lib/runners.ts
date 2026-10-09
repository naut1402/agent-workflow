import fs from 'node:fs'
import path from 'node:path'

export const RUNNERS_FILE = 'tests/runners.json'

export interface Runners {
  /** Path list mà `bun test` sở hữu; phần còn lại dưới `tests/src/**` là vitest. */
  bunTest: string[]
}

/** Đọc `tests/runners.json`; ném lỗi khi thiếu file, sai định dạng hoặc `bunTest` rỗng. */
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
  // xem docs/architecture/code/tooling.md §3
  if (bunTest.length === 0) {
    throw new Error(`${RUNNERS_FILE} có "bunTest" rỗng — khai ít nhất một path, hoặc xoá hẳn file nếu dòng test chưa có suite bun.`)
  }

  return { bunTest: bunTest.map((p) => p.replace(/\/+$/, '')) }
}
