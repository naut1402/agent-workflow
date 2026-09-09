import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  TOLERANCE,
  appendHistory,
  compare,
  historyRow,
  main,
  mergeBaseline,
  parseArgs,
  parseBaseline,
  parseLcovLines,
  readBackend,
  readFrontend,
} from '../../.github/scripts/coverage-gate.js'

/**
 * Cổng coverage là chỗ **duy nhất** phát hiện coverage tụt sau khi test tách
 * sang dòng branch riêng — PR dòng source không còn mang test nào theo, nên
 * không còn chỗ nào tự nhiên lộ ra việc đó.
 *
 * Ba bất biến phải test trực tiếp:
 *  - "thiếu dữ liệu" KHÔNG bao giờ được kết luận là "đạt";
 *  - `--update` chỉ đi lên, không tự hạ baseline;
 *  - dung sai hấp thụ dao động nhưng vẫn phải cảnh báo, không im lặng.
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

  test('bằng baseline → ok', () => {
    const rows = compare(baseline, { frontend: { lines: 60, statements: 59 }, backend: { lines: 83 } })
    expect(rows.every((r) => r.status === 'ok')).toBe(true)
  })

  test('cao hơn baseline → ok', () => {
    const rows = compare(baseline, { frontend: { lines: 70, statements: 65 }, backend: { lines: 90 } })
    expect(rows.every((r) => r.status === 'ok')).toBe(true)
  })

  test('giảm trong dung sai → within-tolerance (đạt nhưng có dấu hiệu)', () => {
    const rows = compare(baseline, { frontend: { lines: 59.6, statements: 59 }, backend: { lines: 83 } })
    expect(rows.find((r) => r.metric === 'frontend.lines')?.status).toBe('within-tolerance')
  })

  test('giảm đúng bằng dung sai vẫn đạt — biên trên là "còn trong dung sai"', () => {
    const rows = compare(baseline, { frontend: { lines: 60 - TOLERANCE, statements: 59 }, backend: { lines: 83 } })
    expect(rows.find((r) => r.metric === 'frontend.lines')?.status).toBe('within-tolerance')
  })

  test('giảm quá dung sai → regressed', () => {
    const rows = compare(baseline, { frontend: { lines: 59.4, statements: 59 }, backend: { lines: 83 } })
    expect(rows.find((r) => r.metric === 'frontend.lines')?.status).toBe('regressed')
  })

  test('chỉ số có ở baseline mà lượt chạy không đo được → missing, KHÔNG phải đạt', () => {
    const rows = compare(baseline, { frontend: { lines: 60, statements: 59 }, backend: {} })
    expect(rows.find((r) => r.metric === 'backend.lines')?.status).toBe('missing')
  })

  test('chỉ số mới xuất hiện ở lượt chạy không bị đòi hỏi — baseline là hợp đồng', () => {
    const rows = compare({ frontend: { lines: 60 } }, { frontend: { lines: 60, branches: 10 }, backend: {} })
    expect(rows.map((r) => r.metric)).toEqual(['frontend.lines'])
  })
})

describe('mergeBaseline', () => {
  test('chỉ đi lên: số mới thấp hơn thì giữ số cũ', () => {
    const next = mergeBaseline({ frontend: { lines: 60 }, backend: { lines: 83 } }, { frontend: { lines: 50 }, backend: { lines: 70 } }, {})
    expect(next.frontend?.lines).toBe(60)
    expect(next.backend?.lines).toBe(83)
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
    const a = parseArgs(['--check'])
    expect(a.mode).toBe('check')
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

  test('override được đường dẫn và dung sai', () => {
    const a = parseArgs(['--update', '--baseline', 'x/b.json', '--history', 'x/h.md', '--tolerance', '1.5'])
    expect(a).toMatchObject({ mode: 'update', baseline: 'x/b.json', history: 'x/h.md', tolerance: 1.5 })
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

  test('coverage ≥ baseline → exit 0', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 }, backend: { lines: 75 } }, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--check', ...f.args])).toBe(0)
  })

  test('tụt quá dung sai → exit khác 0', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 55 }, be: BE_75 })
    expect(main(['--check', ...f.args])).not.toBe(0)
  })

  test('tụt trong dung sai → exit 0 (có cảnh báo trên stderr)', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 59.7 }, be: BE_75 })
    expect(main(['--check', ...f.args])).toBe(0)
  })

  test('thiếu baseline → exit khác 0, KHÔNG coi là đạt', () => {
    const f = fixture({ fe: { lines: 60 }, be: BE_75 })
    expect(main(['--check', ...f.args])).not.toBe(0)
  })

  test('thiếu baseline + --allow-missing → khởi tạo được (chỉ dùng lần đầu)', () => {
    const f = fixture({ fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', '--allow-missing', ...f.args])).toBe(0)
    expect(JSON.parse(fs.readFileSync(f.baselineFile, 'utf8')).frontend.lines).toBe(60)
  })

  test('baseline sai định dạng → exit khác 0, không suy ra 0% rồi kết luận đạt', () => {
    const f = fixture({ baseline: '{ khong-phai-json', fe: { lines: 60 }, be: BE_75 })
    expect(main(['--check', ...f.args])).not.toBe(0)
  })

  test('baseline rỗng chỉ số → exit khác 0', () => {
    const f = fixture({ baseline: {}, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--check', ...f.args])).not.toBe(0)
  })

  test('không có dữ liệu coverage nào → exit khác 0', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } } })
    expect(main(['--check', ...f.args])).not.toBe(0)
  })

  test('--check KHÔNG tự nâng baseline (chỉ --update mới nâng)', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 80 }, be: BE_75 })
    expect(main(['--check', ...f.args])).toBe(0)
    expect(JSON.parse(fs.readFileSync(f.baselineFile, 'utf8')).frontend.lines).toBe(60)
  })

  test('--update chỉ đi lên và ghi thêm một dòng lịch sử', () => {
    const f = fixture({ baseline: { frontend: { lines: 90 } }, fe: { lines: 60 }, be: BE_75 })
    expect(main(['--update', '--source-ref', 'dev/1.1.3/main', '--test-ref', 'test/1.1.3/main', ...f.args])).toBe(0)
    const b = JSON.parse(fs.readFileSync(f.baselineFile, 'utf8'))
    expect(b.frontend.lines).toBe(90)
    expect(b.backend.lines).toBe(75)
    expect(fs.readFileSync(f.historyFile, 'utf8')).toContain('test/1.1.3/main')
  })

  test('không khai chế độ → exit 2 (lỗi cách dùng, khác với lỗi cổng)', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 } }, fe: { lines: 60 }, be: BE_75 })
    expect(main([...f.args])).toBe(2)
  })

  test('baseline có backend mà lượt chạy không đo được → exit khác 0', () => {
    const f = fixture({ baseline: { frontend: { lines: 60 }, backend: { lines: 75 } }, fe: { lines: 60 } })
    expect(main(['--check', ...f.args])).not.toBe(0)
  })
})
