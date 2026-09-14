import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendHistory,
  compare,
  historyRow,
  main,
  mergeBaseline,
  normalizeSha,
  parseArgs,
  parseBaseline,
  parseLcovLines,
  readBackend,
  readFrontend,
} from '../../.github/scripts/coverage-gate.js'

/**
 * 🚫 Đây KHÔNG còn là cổng. Từ 2026-09-11 mức phủ chỉ là **mốc tham chiếu**
 * (`docs/agent-rules/testing.md` §6); nợ test gác theo TASK ở
 * `test-coverage-status.ts`. `coverage-gate.ts` nay chỉ đo, ghi mốc và in bảng.
 *
 * Ba bất biến còn lại phải test trực tiếp:
 *  - `--check` đã bị bỏ ⇒ exit 2 kèm *Cách dùng*, 🚫 không âm thầm chạy như `--update`;
 *  - `--update` ghi **số đo của lượt này**, kể cả khi tụt — mốc 🚫 không phải ratchet;
 *  - vùng không đo được phải nói ra (cảnh báo), 🚫 không im lặng giữ số của lượt trước.
 *
 * ⚠️ Mức phủ tụt 🚫 không còn làm exit khác 0. Case nào khẳng định "tụt → chặn"
 * là đang test một hợp đồng đã chết.
 */

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cov-gate-'))
}

function writeSummary(dir: string, pct: Record<string, number>): string {
  const f = path.join(dir, 'coverage-summary.json')
  const total = Object.fromEntries(
    Object.entries(pct).map(([k, v]) => [k, { total: 100, covered: v, skipped: 0, pct: v }]),
  )
  fs.writeFileSync(f, JSON.stringify({ total }), 'utf8')
  return f
}

describe('parseLcovLines', () => {
  test('tổng LF/LH qua nhiều record', () => {
    const text = ['SF:a.ts', 'LF:10', 'LH:5', 'end_of_record', 'SF:b.ts', 'LF:10', 'LH:10', 'end_of_record'].join('\n')
    expect(parseLcovLines(text)).toBeCloseTo(75, 5)
  })

  test('file rỗng → null (không có dữ liệu), KHÔNG phải 0%', () => {
    expect(parseLcovLines('')).toBe(null)
  })

  test('có record nhưng LF=0 → null, tránh chia cho 0 rồi báo NaN%', () => {
    expect(parseLcovLines('SF:a.ts\nLF:0\nLH:0\nend_of_record')).toBe(null)
  })

  test('bỏ qua dòng không liên quan (BRF/FNF/DA)', () => {
    const text = ['SF:a.ts', 'FNF:3', 'FNH:1', 'BRF:8', 'BRH:2', 'LF:4', 'LH:3', 'end_of_record'].join('\n')
    expect(parseLcovLines(text)).toBeCloseTo(75, 5)
  })
})

describe('readFrontend / readBackend', () => {
  test('thiếu file → object rỗng, để phía trên quyết định là lỗi hay không', () => {
    expect(readFrontend('/khong/ton/tai.json')).toEqual({})
    expect(readBackend('/khong/ton/tai.info')).toEqual({})
  })

  test('coverage-summary.json không có "total" → throw, không đoán 0%', () => {
    const dir = tmp()
    const f = path.join(dir, 'coverage-summary.json')
    fs.writeFileSync(f, JSON.stringify({ '/src/a.ts': {} }), 'utf8')
    expect(() => readFrontend(f)).toThrow(/total/)
  })

  test('lấy đúng 4 chỉ số của total', () => {
    const dir = tmp()
    const f = writeSummary(dir, { lines: 60.5, statements: 59, functions: 57.75, branches: 53.66 })
    expect(readFrontend(f)).toEqual({ lines: 60.5, statements: 59, functions: 57.75, branches: 53.66 })
  })

  test('backend làm tròn 2 chữ số như vitest', () => {
    const dir = tmp()
    const f = path.join(dir, 'lcov.info')
    fs.writeFileSync(f, 'SF:a.ts\nLF:3\nLH:1\nend_of_record', 'utf8')
    expect(readBackend(f)).toEqual({ lines: 33.33 })
  })
})

describe('parseBaseline', () => {
  test('đọc được cả hai nhánh', () => {
    const b = parseBaseline('{"frontend":{"lines":60},"backend":{"lines":83}}', 'x.json')
    expect(b.frontend?.lines).toBe(60)
    expect(b.backend?.lines).toBe(83)
  })

  test.each([
    ['', 'file rỗng'],
    ['{', 'JSON sai cú pháp'],
    ['{}', 'không có chỉ số nào'],
    ['{"frontend":{}}', 'nhánh rỗng'],
    ['{"frontend":{"lines":"60"}}', 'chỉ số là string'],
    ['{"frontend":{"lines":140}}', 'phần trăm ngoài [0,100]'],
    ['{"frontend":{"lines":-1}}', 'phần trăm âm'],
    ['[]', 'không phải object'],
  ])('%s → throw (%s)', (raw) => {
    expect(() => parseBaseline(raw, 'x.json')).toThrow()
  })
})

describe('compare', () => {
  const baseline = { frontend: { lines: 60, statements: 59 }, backend: { lines: 83 } }

  // Từ 2026-09-11 mức phủ 🚫 không còn là cổng (`testing.md` §6) — nợ test gác theo
  // task ở `test-coverage-status.ts`. Nên `compare` chỉ còn **hiển thị**: không cột
  // kết luận (`status`), không dung sai. Các case dưới khoá đúng hợp đồng đó.

  test('bằng baseline → delta 0, và 🚫 không có cột kết luận nào', () => {
    const rows = compare(baseline, { frontend: { lines: 60, statements: 59 }, backend: { lines: 83 } })
    expect(rows.every((r) => r.delta === 0)).toBe(true)
    expect(rows.every((r) => !('status' in r))).toBe(true)
  })

  test('cao hơn baseline → delta dương', () => {
    const rows = compare(baseline, { frontend: { lines: 70, statements: 65 }, backend: { lines: 90 } })
    expect(rows.find((r) => r.metric === 'frontend.lines')).toMatchObject({ baseline: 60, current: 70, delta: 10 })
  })

  test('giảm → delta âm, KHÔNG phán quyết — sụt bao nhiêu cũng chỉ là số', () => {
    const rows = compare(baseline, { frontend: { lines: 40, statements: 59 }, backend: { lines: 83 } })
    expect(rows.find((r) => r.metric === 'frontend.lines')).toMatchObject({ baseline: 60, current: 40, delta: -20 })
  })

  test('chỉ số có ở baseline mà lượt chạy không đo được → vẫn hiện, current/delta undefined', () => {
    const rows = compare(baseline, { frontend: { lines: 60, statements: 59 }, backend: {} })
    expect(rows.find((r) => r.metric === 'backend.lines')).toMatchObject({ baseline: 83, current: undefined, delta: undefined })
  })

  test('chỉ số mới xuất hiện ở lượt chạy VẪN hiện — lấy hợp, baseline 🚫 không còn là hợp đồng', () => {
    const rows = compare({ frontend: { lines: 60 } }, { frontend: { lines: 60, branches: 10 }, backend: {} })
    expect(rows.map((r) => r.metric)).toEqual(['frontend.lines', 'frontend.branches'])
    expect(rows.find((r) => r.metric === 'frontend.branches')).toMatchObject({ baseline: undefined, current: 10, delta: undefined })
  })

  test('không bên nào có chỉ số → 🚫 không đẻ ra dòng rỗng', () => {
    const rows = compare({ frontend: { lines: 60 } }, { frontend: { lines: 60 }, backend: {} })
    expect(rows.map((r) => r.metric)).toEqual(['frontend.lines'])
  })
})

describe('mergeBaseline', () => {
  // Bản cũ "chỉ đi lên" (số mới thấp hơn thì giữ số cũ) đã bỏ cùng cổng mức phủ:
  // mốc nay là **số đo của lượt gần nhất**, không phải hợp đồng phải giữ. Giữ lại
  // hành vi ratchet ở đây sẽ làm mốc nói dối về cây hiện tại.
  test('số mới thấp hơn vẫn ghi đè — mốc là số đo, 🚫 không phải ratchet', () => {
    const next = mergeBaseline({ frontend: { lines: 60 }, backend: { lines: 83 } }, { frontend: { lines: 50 }, backend: { lines: 70 } }, {})
    expect(next.frontend?.lines).toBe(50)
    expect(next.backend?.lines).toBe(70)
  })

  test('số mới cao hơn thì nâng lên', () => {
    const next = mergeBaseline({ frontend: { lines: 60 } }, { frontend: { lines: 61.2 }, backend: { lines: 90 } }, {})
    expect(next.frontend?.lines).toBe(61.2)
    expect(next.backend?.lines).toBe(90)
  })

  test('baseline rỗng (khởi tạo lần đầu) lấy nguyên số đo được', () => {
    const next = mergeBaseline({}, { frontend: { lines: 60.56 }, backend: { lines: 83.07 } }, {})
    expect(next.frontend?.lines).toBe(60.56)
    expect(next.backend?.lines).toBe(83.07)
  })

  test('ghi kèm meta để truy được lượt chạy nào đã nâng', () => {
    const next = mergeBaseline({}, { frontend: { lines: 60 }, backend: {} }, {
      source_ref: 'dev/1.1.3/main',
      test_ref: 'test/1.1.3/main',
      at: '2026-09-09T00:00:00.000Z',
    })
    expect(next).toMatchObject({
      updated_at: '2026-09-09T00:00:00.000Z',
      source_ref: 'dev/1.1.3/main',
      test_ref: 'test/1.1.3/main',
    })
  })

  test('không đo được nhánh nào thì không tạo khoá rỗng cho nhánh đó', () => {
    const next = mergeBaseline({}, { frontend: { lines: 60 }, backend: {} }, {})
    expect(next.backend).toBeUndefined()
  })
})

describe('lịch sử', () => {
  test('dòng log có version/ref để lần theo được', () => {
    const row = historyRow({ frontend: { lines: 60.56 }, backend: { lines: 83.07 } }, {
      source_ref: 'dev/1.1.3/main',
      test_ref: 'test/1.1.3/main',
      at: '2026-09-09T06:47:05.887Z',
    })
    expect(row).toContain('test/1.1.3/main')
    expect(row).toContain('dev/1.1.3/main')
    expect(row).toContain('60.56%')
    expect(row).toContain('83.07%')
  })

  test('nhánh không đo được hiện "—" chứ không hiện 0%', () => {
    const row = historyRow({ frontend: { lines: 60 }, backend: {} }, { at: '2026-09-09T00:00:00.000Z' })
    // Cột cuối là BE lines. "0%" ở đó sẽ bị đọc là "backend không có test nào".
    const cells = row.split('|').map((c) => c.trim())
    expect(cells.at(-2)).toBe('—')
  })

  test('append giữ nguyên dòng cũ và tự dựng header lần đầu', () => {
    const dir = tmp()
    const f = path.join(dir, 'reports', 'coverage-history.md')
    appendHistory(f, '| a |')
    appendHistory(f, '| b |')
    const text = fs.readFileSync(f, 'utf8')
    expect(text).toContain('| Thời điểm (UTC) |')
    expect(text.indexOf('| a |')).toBeLessThan(text.indexOf('| b |'))
  })
})

describe('parseArgs', () => {
  test('mặc định trỏ đúng ba file dữ liệu của cổng', () => {
    const a = parseArgs(['--update'])
    expect(a.mode).toBe('update')
    expect(a.baseline).toBe('reports/coverage-baseline.json')
    expect(a.fe).toBe('coverage/frontend/coverage-summary.json')
    expect(a.be).toBe('coverage/backend/lcov.info')
  })

  test('không khai chế độ → null, để CLI báo cách dùng thay vì đoán', () => {
    expect(parseArgs([]).mode).toBe(null)
  })

  test('--allow-missing phải khai tường minh (mặc định thiếu baseline là đỏ)', () => {
    expect(parseArgs(['--check']).allowMissing).toBe(false)
    expect(parseArgs(['--check', '--allow-missing']).allowMissing).toBe(true)
  })

  test('override được đường dẫn (🚫 không còn --tolerance: dung sai đi cùng cổng đã bỏ)', () => {
    const a = parseArgs(['--update', '--baseline', 'x/b.json', '--history', 'x/h.md'])
    expect(a).toMatchObject({ mode: 'update', baseline: 'x/b.json', history: 'x/h.md' })
  })
})

/**
 * Mã thoát của CLI — đây là thứ CI thật đọc. Bảng in ra chỉ để người xem, còn
 * quyết định chặn/không chặn nằm ở exit code, nên phải test trực tiếp.
 */
describe('main (exit code)', () => {
  function fixture(opts: { baseline?: object | string; fe?: Record<string, number>; be?: string }) {
    const dir = tmp()
    const feFile = path.join(dir, 'coverage-summary.json')
    const beFile = path.join(dir, 'lcov.info')
    const baselineFile = path.join(dir, 'reports', 'coverage-baseline.json')
    const historyFile = path.join(dir, 'reports', 'coverage-history.md')

    if (opts.fe) writeSummary(dir, opts.fe)
    if (opts.be !== undefined) fs.writeFileSync(beFile, opts.be, 'utf8')
    if (opts.baseline !== undefined) {
      fs.mkdirSync(path.dirname(baselineFile), { recursive: true })
      fs.writeFileSync(
        baselineFile,
        typeof opts.baseline === 'string' ? opts.baseline : JSON.stringify(opts.baseline),
        'utf8',
      )
    }
    const args = ['--baseline', baselineFile, '--fe', feFile, '--be', beFile, '--history', historyFile]
    return { dir, baselineFile, historyFile, args }
  }

  const BE_75 = 'SF:a.ts\nLF:4\nLH:3\nend_of_record'

  // ⚠️ Cụm này trước đây gọi `--check`. Sau khi cổng mức phủ bị bỏ, `--check` trả
  // exit 2 (lỗi cách dùng) nên mọi case `not.toBe(0)` vẫn xanh — nhưng xanh vì
  // "cờ không tồn tại", không phải vì điều nó định khẳng định. Đã đổi hết sang
  // `--update` để test lại nói đúng thứ nó kiểm.

  test('coverage tụt sâu vẫn exit 0 — mức phủ 🚫 không còn chặn', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 20 }, be: BE_75 })
    expect(main(['--update', ...f.args])).toBe(0)
    expect(JSON.parse(fs.readFileSync(f.baselineFile, 'utf8')).frontend.lines).toBe(20)
  })

  test('thiếu baseline → exit khác 0, KHÔNG âm thầm khởi tạo', () => {
    const f = fixture({ fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', ...f.args])).not.toBe(0)
  })

  test('thiếu baseline + --allow-missing → khởi tạo được (chỉ dùng lần đầu)', () => {
    const f = fixture({ fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', '--allow-missing', ...f.args])).toBe(0)
    expect(JSON.parse(fs.readFileSync(f.baselineFile, 'utf8')).frontend.lines).toBe(60)
  })

  test('baseline sai định dạng → exit khác 0, không suy ra 0% rồi kết luận đạt', () => {
    const f = fixture({ baseline: '{ khong-phai-json', fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', ...f.args])).not.toBe(0)
  })

  test('baseline rỗng chỉ số → exit khác 0', () => {
    const f = fixture({ baseline: {}, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', ...f.args])).not.toBe(0)
  })

  test('không có dữ liệu coverage nào → exit khác 0', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } } })
    expect(main(['--update', ...f.args])).not.toBe(0)
  })

  test('`--check` bị từ chối (exit 2) và 🚫 KHÔNG đụng vào baseline', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 80 }, be: BE_75 })
    expect(main(['--check', ...f.args])).toBe(2)
    expect(JSON.parse(fs.readFileSync(f.baselineFile, 'utf8')).frontend.lines).toBe(60)
  })

  test('--update ghi đè cả khi số tụt, và ghi thêm một dòng lịch sử', () => {
    const f = fixture({ baseline: { frontend: { lines: 90 } }, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', '--source-ref', 'dev/1.1.3/main', '--test-ref', 'test/1.1.3/main', ...f.args])).toBe(0)
    const b = JSON.parse(fs.readFileSync(f.baselineFile, 'utf8'))
    expect(b.frontend.lines).toBe(60)
    expect(b.backend.lines).toBe(75)
    expect(fs.readFileSync(f.historyFile, 'utf8')).toContain('test/1.1.3/main')
  })

  test('không khai chế độ → exit 2 (lỗi cách dùng, khác với lỗi cổng)', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 60 }, be: BE_75 })
    expect(main([...f.args])).toBe(2)
  })

  test('lượt chạy không đo được backend → CẢNH BÁO rồi exit 0, chỉ ghi mốc vùng frontend (TC-D8)', () => {
    // 🚫 Không còn chặn, nhưng cũng 🚫 không im lặng: giữ nguyên số backend cũ mà
    // không nói gì là để người đọc tưởng đó là số của lượt này.
    const f = fixture({ baseline: { frontend: { lines: 60 }, backend: { lines: 75 } }, fe: { lines: 70 } })
    expect(main(['--update', ...f.args])).toBe(0)
    const b = JSON.parse(fs.readFileSync(f.baselineFile, 'utf8'))
    expect(b.frontend.lines).toBe(70)
    expect(b.backend.lines).toBe(75)
  })

  const SHA_A = 'a'.repeat(40)
  const SHA_B = 'b'.repeat(40)

  test('--update ghi đúng 2 khoá neo, giữ nguyên giá trị VÀ nghĩa của khoá cũ', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 }, backend: { lines: 75 }, source_ref: 'dev/1.1.3/main', test_ref: 'test/1.1.3/main' }, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', '--source-ref', 'dev/1.1.4/main', '--test-ref', 'test/1.1.4/main', '--source-sha', SHA_A, '--test-sha', SHA_B, ...f.args])).toBe(0)
    const b = JSON.parse(fs.readFileSync(f.baselineFile, 'utf8'))
    expect(b).toMatchObject({
      source_ref: 'dev/1.1.4/main',
      test_ref: 'test/1.1.4/main',
      source_sha: SHA_A,
      test_sha: SHA_B,
      frontend: { lines: 60 },
      backend: { lines: 75 },
    })
  })

  test('chạy lại với cùng cặp SHA không sinh diff rác (chỉ updated_at đổi) + có newline cuối file', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 60 }, be: BE_75 })
    const run = () => {
      expect(main(['--update', '--source-sha', SHA_A, '--test-sha', SHA_B, ...f.args])).toBe(0)
      return fs.readFileSync(f.baselineFile, 'utf8')
    }
    const first = run()
    const second = run()
    expect(second.endsWith('\n')).toBe(true)
    const strip = (t: string) => t.replace(/^\s*"updated_at".*$/m, '')
    expect(strip(second)).toBe(strip(first))
  })

  test('khoá lạ do tooling khác ghi vẫn còn sau --update (round-trip không mất dữ liệu)', () => {
    const f = fixture({ baseline: { $comment: 'ghi chú của người khác', frontend: { lines: 60 } }, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', '--source-sha', SHA_A, ...f.args])).toBe(0)
    expect(JSON.parse(fs.readFileSync(f.baselineFile, 'utf8')).$comment).toBe('ghi chú của người khác')
  })

  test('SHA rỗng → exit khác 0 và KHÔNG ghi khoá neo rỗng vào baseline', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', '--source-sha', '', ...f.args])).toBe(2)
    const b = JSON.parse(fs.readFileSync(f.baselineFile, 'utf8'))
    expect('source_sha' in b).toBe(false)
    // Cả file cũng không được ghi nửa vời: số cũ giữ nguyên.
    expect(b.frontend.lines).toBe(60)
  })

  test('SHA viết tắt bị TỪ CHỐI — không lưu chuỗi tắt rồi so bằng chuỗi ở cổng neo', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', '--source-sha', 'abc1234', ...f.args])).toBe(2)
    expect('source_sha' in JSON.parse(fs.readFileSync(f.baselineFile, 'utf8'))).toBe(false)
  })

  test('baseline CHƯA có khoá neo vẫn --check bình thường (không đỏ vô cớ sau PR neo)', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 }, backend: { lines: 75 }, source_ref: 'dev/1.1.3/main' }, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', ...f.args])).toBe(0)
  })

  test('có neo mà coverage tụt → exit 0: coverage 🚫 không còn là lý do chặn', () => {
    // Bản cũ trả 1 ở đây để "hai lý do chặn không trộn". Nay chỉ còn MỘT lý do
    // chặn liên quan neo (SHA lệch), còn mức phủ thì không chặn nữa.
    const f = fixture({ baseline: { frontend: { lines: 60 }, source_sha: SHA_A }, fe: { lines: 50 }, be: BE_75 })
    expect(main(['--update', ...f.args])).toBe(0)
  })
})

describe('mergeBaseline — neo SHA', () => {
  const at = '2026-09-09T00:00:00.000Z'

  test('ghi neo từ meta', () => {
    const next = mergeBaseline({}, { frontend: { lines: 60 }, backend: {} }, { source_sha: 'a'.repeat(40), test_sha: 'b'.repeat(40), at })
    expect(next).toMatchObject({ source_sha: 'a'.repeat(40), test_sha: 'b'.repeat(40) })
  })

  test('neo GHI ĐÈ, KHÔNG max() — neo là thời điểm, max() trên chuỗi SHA là vô nghĩa', () => {
    const old = { frontend: { lines: 60 }, source_sha: 'f'.repeat(40), test_sha: 'f'.repeat(40) }
    const next = mergeBaseline(old, { frontend: { lines: 60 }, backend: {} }, { source_sha: '0'.repeat(40), test_sha: '1'.repeat(40), at })
    expect(next.source_sha).toBe('0'.repeat(40))
    expect(next.test_sha).toBe('1'.repeat(40))
  })

  test('lượt ghi số mà KHÔNG khai neo thì BỎ neo cũ — thà `no-anchor` còn hơn neo lệch', () => {
    // Neo cũ mô tả cây khác, mà số coverage vừa được nâng theo lượt mới. Giữ lại là
    // để cổng neo so head PR với cây đó rồi in "neo khớp" cho số đo ở nơi khác.
    const next = mergeBaseline(
      { frontend: { lines: 60 }, source_sha: 'a'.repeat(40), test_sha: 'b'.repeat(40) },
      { frontend: { lines: 61 }, backend: {} },
      { at },
    )
    expect('source_sha' in next).toBe(false)
    expect('test_sha' in next).toBe(false)
    expect(next.frontend?.lines).toBe(61)
  })

  test('hai khoá neo độc lập: khai nửa neo thì nửa còn lại bị bỏ', () => {
    const next = mergeBaseline(
      { frontend: { lines: 60 }, source_sha: 'a'.repeat(40), test_sha: 'b'.repeat(40) },
      { frontend: { lines: 60 }, backend: {} },
      { source_sha: 'c'.repeat(40), at },
    )
    expect(next.source_sha).toBe('c'.repeat(40))
    expect('test_sha' in next).toBe(false)
  })

  test('baseline chưa có neo + lượt không khai neo → vẫn không có neo, không cảnh báo vô cớ', () => {
    const next = mergeBaseline({ frontend: { lines: 60 } }, { frontend: { lines: 61 }, backend: {} }, { at })
    expect('source_sha' in next).toBe(false)
    expect(next.frontend?.lines).toBe(61)
  })

  test('nửa neo: chỉ có source_sha thì không dựng khoá test_sha rỗng', () => {
    const next = mergeBaseline({}, { frontend: { lines: 60 }, backend: {} }, { source_sha: 'a'.repeat(40), at })
    expect(next.test_sha).toBeUndefined()
  })

  test('historyRow vẫn ĐÚNG 5 cột sau khi meta có thêm neo', () => {
    const row = historyRow({ frontend: { lines: 60 }, backend: { lines: 75 } }, { source_ref: 'dev/1.1.4/main', test_ref: 'test/1.1.4/main', source_sha: 'a'.repeat(40), at })
    expect(row.split('|').filter((c) => c.trim()).length).toBe(5)
    expect(row).not.toContain('a'.repeat(40))
  })
})

describe('normalizeSha', () => {
  test('SHA đủ 40 hex → nhận, hạ về chữ thường', () => {
    expect(normalizeSha('A'.repeat(40), '--source-sha')).toBe('a'.repeat(40))
  })

  test('rỗng / chỉ space → throw, nêu đúng cờ nào thiếu', () => {
    expect(() => normalizeSha('', '--source-sha')).toThrow(/--source-sha rỗng/)
    expect(() => normalizeSha('   ', '--test-sha')).toThrow(/--test-sha rỗng/)
  })

  test('viết tắt hoặc không phải hex → throw', () => {
    expect(() => normalizeSha('abc1234', '--source-sha')).toThrow(/không phải SHA đầy đủ/)
    expect(() => normalizeSha('z'.repeat(40), '--source-sha')).toThrow(/không phải SHA đầy đủ/)
  })
})

describe('parseArgs — cờ neo SHA', () => {
  test('nhận 2 cờ mới', () => {
    const a = parseArgs(['--update', '--source-sha', 'a'.repeat(40), '--test-sha', 'b'.repeat(40)])
    expect(a).toMatchObject({ mode: 'update', sourceSha: 'a'.repeat(40), testSha: 'b'.repeat(40) })
  })

  test('bảng cờ giữ đúng hai kiểu "thiếu tham số" của bản cũ', () => {
    // Cờ đường dẫn: giữ default. Cờ ref/sha: undefined (để main báo cách dùng).
    expect(parseArgs(['--update', '--baseline']).baseline).toBe('reports/coverage-baseline.json')
    expect(parseArgs(['--update', '--source-ref']).sourceRef).toBeUndefined()
    expect(parseArgs(['--update', '--source-sha']).sourceSha).toBeUndefined()
  })

  test('`--check` đã bị bỏ ⇒ cờ lạ ⇒ mode null, để CLI báo cách dùng thay vì âm thầm chạy', () => {
    expect(parseArgs(['--check']).mode).toBe(null)
  })

  test('cờ lạ bị bỏ qua, không làm hỏng các cờ sau nó', () => {
    const a = parseArgs(['--update', '--khong-ton-tai', '--source-sha', 'a'.repeat(40)])
    expect(a).toMatchObject({ mode: 'update', sourceSha: 'a'.repeat(40) })
  })
})
