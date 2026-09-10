import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RUNNERS_FILE, readRunners } from '../../.github/scripts/lib/runners.js'

/**
 * `tests/runners.json` là nguồn sự thật duy nhất phân runner, và nó sống ở
 * **dòng test**. Nên "thiếu file" có nghĩa là "chưa ghép cây test", KHÔNG có
 * nghĩa "không có test nào" — và phải nói ra bằng exception, vì im lặng trả
 * danh sách rỗng sẽ làm mọi suite biến thành vitest và CI báo xanh giả.
 */

function tmpRoot(content?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-runners-'))
  if (content !== undefined) {
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true })
    fs.writeFileSync(path.join(root, RUNNERS_FILE), content, 'utf8')
  }
  return root
}

describe('readRunners', () => {
  test('đọc đúng danh sách bunTest', () => {
    const root = tmpRoot('{"bunTest":["tests/src/server","tests/mcp"]}')
    expect(readRunners(root).bunTest).toEqual(['tests/src/server', 'tests/mcp'])
  })

  test('bỏ dấu / ở cuối path để so prefix không lệch', () => {
    const root = tmpRoot('{"bunTest":["tests/mcp/","tests/tools//"]}')
    expect(readRunners(root).bunTest).toEqual(['tests/mcp', 'tests/tools'])
  })

  test('khoá lạ trong file không làm vỡ (vd $comment)', () => {
    const root = tmpRoot('{"$comment":"ghi chú","bunTest":["tests/mcp"]}')
    expect(readRunners(root).bunTest).toEqual(['tests/mcp'])
  })

  test('thiếu file → throw, thông điệp nêu đúng lệnh cần chạy', () => {
    const root = tmpRoot()
    expect(() => readRunners(root)).toThrow(/test:overlay/)
  })

  test('JSON sai cú pháp → throw nêu tên file, không suy ra danh sách rỗng', () => {
    const root = tmpRoot('{"bunTest": [')
    expect(() => readRunners(root)).toThrow(/runners\.json/)
  })

  test.each([
    ['{}', 'thiếu khoá bunTest'],
    ['{"bunTest":"tests/mcp"}', 'bunTest không phải array'],
    ['{"bunTest":[1,2]}', 'phần tử không phải string'],
    ['{"bunTest":["tests/mcp",""]}', 'phần tử rỗng'],
    ['null', 'file rỗng nghĩa'],
  ])('%s → throw (%s)', (content) => {
    const root = tmpRoot(content)
    expect(() => readRunners(root)).toThrow()
  })

  // `bun test` không có path nào sẽ quét TOÀN BỘ repo và chạy cả file thuộc
  // runner khác — im lặng và sai. "Rỗng" ở đây phải là lỗi cấu hình, không phải
  // "chưa khai".
  test('danh sách rỗng → throw, không để bun test quét cả repo', () => {
    const root = tmpRoot('{"bunTest":[]}')
    expect(() => readRunners(root)).toThrow(/rỗng/)
  })
})

describe('tests/runners.json của repo', () => {
  const ROOT = path.resolve(import.meta.dir, '..', '..')

  test('parse được và mọi path đều tồn tại', () => {
    const { bunTest } = readRunners(ROOT)
    expect(bunTest.length).toBeGreaterThan(0)
    for (const p of bunTest) {
      expect(fs.existsSync(path.join(ROOT, p))).toBe(true)
    }
  })

  test('không có path nào là prefix của path khác — trùng lặp làm bun test chạy hai lần', () => {
    const { bunTest } = readRunners(ROOT)
    for (const a of bunTest) {
      for (const b of bunTest) {
        if (a !== b) expect(b.startsWith(`${a}/`)).toBe(false)
      }
    }
  })
})
