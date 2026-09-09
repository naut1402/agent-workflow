#!/usr/bin/env bun
/**
 * Cổng coverage — chặn **xu hướng tụt**, không chỉ chặn một ngưỡng tuyệt đối.
 *
 * Vì sao cần: sau khi test tách sang dòng branch riêng, PR ở dòng source không
 * còn mang test nào theo, nên "coverage tụt" không còn tự hiện ra trong diff.
 * Cổng này là chỗ duy nhất phát hiện việc đó.
 *
 * Hai chế độ:
 *   --check    so số của lượt chạy hiện tại với baseline, tụt quá dung sai → exit 1
 *   --update   nâng baseline lên số mới (chỉ đi lên) + ghi một dòng lịch sử
 *
 * Bất biến:
 *   - **Thiếu baseline là lỗi**, không phải "đạt" — trừ khi khai `--allow-missing`
 *     (chỉ dùng cho lượt khởi tạo baseline đầu tiên của repo).
 *   - Baseline sai định dạng là lỗi — không suy ra 0% rồi kết luận đạt.
 *   - `--update` không bao giờ **hạ** baseline; muốn hạ thì sửa file bằng tay
 *     trong một PR test có ghi lý do.
 *
 *   bun run coverage:gate -- --check
 *   bun run coverage:gate -- --update --source-ref dev/1.1.3/main --test-ref test/1.1.3/main
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dir, '..', '..')

/** Điểm phần trăm. Hấp thụ dao động do source thêm/bớt file, không phải để nới cho test tụt. */
export const TOLERANCE = 0.5

export const FE_METRICS = ['lines', 'statements', 'functions', 'branches'] as const
type FeMetric = (typeof FE_METRICS)[number]

export interface Baseline {
  frontend?: Partial<Record<FeMetric, number>>
  backend?: { lines?: number }
  updated_at?: string
  source_ref?: string
  test_ref?: string
}

export interface Measured {
  frontend: Partial<Record<FeMetric, number>>
  backend: { lines?: number }
}

/** `coverage-summary.json` của vitest → pct từng chỉ số. */
export function readFrontend(file: string): Partial<Record<FeMetric, number>> {
  if (!fs.existsSync(file)) return {}
  const total = JSON.parse(fs.readFileSync(file, 'utf8'))?.total
  if (!total) throw new Error(`${file} không có khoá "total" — reporter json-summary chưa bật?`)
  const out: Partial<Record<FeMetric, number>> = {}
  for (const m of FE_METRICS) {
    const pct = total[m]?.pct
    if (typeof pct === 'number' && Number.isFinite(pct)) out[m] = pct
  }
  return out
}

/**
 * `lcov.info` → tỷ lệ dòng tổng. Chỉ lấy **một** con số lines: chia nhỏ theo
 * module là việc của task sau, còn một con số thì đủ để chặn xu hướng tụt.
 */
export function parseLcovLines(text: string): number | null {
  let found = 0
  let hit = 0
  let sawRecord = false
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.startsWith('LF:')) {
      found += Number(t.slice(3)) || 0
      sawRecord = true
    } else if (t.startsWith('LH:')) {
      hit += Number(t.slice(3)) || 0
      sawRecord = true
    }
  }
  // File rỗng / không có record nào: không có dữ liệu, khác hẳn "0% coverage".
  if (!sawRecord || found === 0) return null
  return (hit / found) * 100
}

export function readBackend(file: string): { lines?: number } {
  if (!fs.existsSync(file)) return {}
  const pct = parseLcovLines(fs.readFileSync(file, 'utf8'))
  // Làm tròn 2 chữ số như vitest, để baseline hai runner cùng độ chính xác.
  return pct === null ? {} : { lines: Math.round(pct * 100) / 100 }
}

/** Baseline phải parse được **và** có ít nhất một chỉ số — nửa vời thì cổng vô nghĩa. */
export function parseBaseline(raw: string, file: string): Baseline {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Baseline ${file} không phải JSON hợp lệ: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`Baseline ${file} phải là object JSON.`)
  const b = parsed as Baseline
  const fe = b.frontend ?? {}
  const be = b.backend ?? {}
  const nums = [...Object.values(fe), be.lines].filter((v) => v !== undefined)
  if (!nums.length) throw new Error(`Baseline ${file} không có chỉ số nào (frontend.* / backend.lines) — file rỗng hoặc thiếu khoá.`)
  for (const v of nums) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      throw new Error(`Baseline ${file} có chỉ số không phải phần trăm hợp lệ: ${JSON.stringify(v)}`)
    }
  }
  return b
}

export interface Row {
  metric: string
  baseline: number
  current: number | undefined
  delta: number | undefined
  status: 'ok' | 'within-tolerance' | 'regressed' | 'missing'
}

/** So từng chỉ số **có mặt ở baseline**; chỉ số mới xuất hiện ở lượt chạy không bị đòi hỏi. */
export function compare(baseline: Baseline, now: Measured, tolerance = TOLERANCE): Row[] {
  const rows: Row[] = []
  const push = (metric: string, base: number | undefined, cur: number | undefined) => {
    if (base === undefined) return
    if (cur === undefined) {
      rows.push({ metric, baseline: base, current: undefined, delta: undefined, status: 'missing' })
      return
    }
    const delta = cur - base
    const status = delta >= 0 ? 'ok' : delta >= -tolerance ? 'within-tolerance' : 'regressed'
    rows.push({ metric, baseline: base, current: cur, delta, status })
  }
  for (const m of FE_METRICS) push(`frontend.${m}`, baseline.frontend?.[m], now.frontend[m])
  push('backend.lines', baseline.backend?.lines, now.backend.lines)
  return rows
}

/** Baseline mới = max(cũ, mới) từng chỉ số. Không bao giờ hạ. */
export function mergeBaseline(baseline: Baseline, now: Measured, meta: { source_ref?: string; test_ref?: string; at?: string }): Baseline {
  const frontend: Partial<Record<FeMetric, number>> = { ...(baseline.frontend ?? {}) }
  for (const m of FE_METRICS) {
    const cur = now.frontend[m]
    if (cur === undefined) continue
    frontend[m] = Math.max(frontend[m] ?? 0, cur)
  }
  const backend = { ...(baseline.backend ?? {}) }
  if (now.backend.lines !== undefined) backend.lines = Math.max(backend.lines ?? 0, now.backend.lines)

  const out: Baseline = { updated_at: meta.at ?? new Date().toISOString() }
  if (Object.keys(frontend).length) out.frontend = frontend
  if (Object.keys(backend).length) out.backend = backend
  if (meta.source_ref) out.source_ref = meta.source_ref
  if (meta.test_ref) out.test_ref = meta.test_ref
  return out
}

export function historyRow(now: Measured, meta: { source_ref?: string; test_ref?: string; at?: string }): string {
  const pct = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(2)}%`)
  const at = (meta.at ?? new Date().toISOString()).slice(0, 19).replace('T', ' ')
  return `| ${at} | ${meta.test_ref ?? '—'} | ${meta.source_ref ?? '—'} | ${pct(now.frontend.lines)} | ${pct(now.backend.lines)} |`
}

const HISTORY_HEADER = [
  '# Lịch sử coverage',
  '',
  'Log cho **người đọc** — cổng chặn merge đọc `coverage-baseline.json`, không đọc file này.',
  'Mỗi dòng là một lượt CI đã cập nhật baseline.',
  '',
  '| Thời điểm (UTC) | Ref test | Ref source | FE lines | BE lines |',
  '|---|---|---|---|---|',
  '',
].join('\n')

export function appendHistory(file: string, row: string): void {
  const head = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : HISTORY_HEADER
  const body = head.endsWith('\n') ? head : `${head}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${body}${row}\n`, 'utf8')
}

function table(rows: Row[]): string {
  const fmt = (v: number | undefined, suffix = '%') => (v === undefined ? '—' : `${v.toFixed(2)}${suffix}`)
  const sign = (v: number | undefined) => (v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
  return [
    '| Chỉ số | Baseline | Hiện tại | Delta | Kết luận |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| \`${r.metric}\` | ${fmt(r.baseline)} | ${fmt(r.current)} | ${sign(r.delta)} | ${r.status} |`),
  ].join('\n')
}

interface Args {
  mode: 'check' | 'update' | null
  baseline: string
  fe: string
  be: string
  history: string
  sourceRef?: string
  testRef?: string
  allowMissing: boolean
  tolerance: number
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    mode: null,
    baseline: 'reports/coverage-baseline.json',
    fe: 'coverage/frontend/coverage-summary.json',
    be: 'coverage/backend/lcov.info',
    history: 'reports/coverage-history.md',
    allowMissing: false,
    tolerance: TOLERANCE,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') out.mode = 'check'
    else if (a === '--update') out.mode = 'update'
    else if (a === '--baseline') out.baseline = argv[++i] ?? out.baseline
    else if (a === '--fe') out.fe = argv[++i] ?? out.fe
    else if (a === '--be') out.be = argv[++i] ?? out.be
    else if (a === '--history') out.history = argv[++i] ?? out.history
    else if (a === '--source-ref') out.sourceRef = argv[++i]
    else if (a === '--test-ref') out.testRef = argv[++i]
    else if (a === '--allow-missing') out.allowMissing = true
    else if (a === '--tolerance') out.tolerance = Number(argv[++i]) || 0
  }
  return out
}

function abs(p: string): string {
  return path.isAbsolute(p) ? p : path.join(ROOT, p)
}

function summary(text: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY
  if (f) fs.appendFileSync(f, `${text}\n`)
}

export function main(argv: string[]): number {
  const args = parseArgs(argv)
  if (!args.mode) {
    console.error('Cách dùng: coverage-gate.ts (--check | --update) [--baseline <path>] [--fe <path>] [--be <path>]')
    return 2
  }

  const baselineFile = abs(args.baseline)
  const now: Measured = { frontend: readFrontend(abs(args.fe)), backend: readBackend(abs(args.be)) }

  if (!Object.keys(now.frontend).length && now.backend.lines === undefined) {
    console.error(
      `Không đọc được dữ liệu coverage nào (${args.fe} · ${args.be}).\n` +
        'Chạy `bun run test:fe` (frontend) và `bun run test -- --coverage` (backend) trước khi gọi cổng.',
    )
    return 1
  }

  // Vùng chưa đo được phải nói ra, không im lặng gác nửa cây test (TC-D8).
  if (now.backend.lines === undefined) {
    console.warn(`Cảnh báo: không có dữ liệu coverage backend (${args.be}) — cổng chỉ gác vùng frontend ở lượt này.`)
  }

  let baseline: Baseline
  if (!fs.existsSync(baselineFile)) {
    if (!args.allowMissing) {
      console.error(
        `Không thấy baseline ${args.baseline}.\n` +
          'Thiếu baseline KHÔNG được coi là đạt. Khởi tạo một lần bằng:\n' +
          `  bun run coverage:gate -- --update --allow-missing --baseline ${args.baseline}`,
      )
      return 1
    }
    console.warn(`Chưa có baseline ${args.baseline} — khởi tạo mới từ lượt chạy này.`)
    baseline = {}
  } else {
    try {
      baseline = parseBaseline(fs.readFileSync(baselineFile, 'utf8'), args.baseline)
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e))
      return 1
    }
  }

  if (args.mode === 'update') {
    const at = new Date().toISOString()
    const meta = { source_ref: args.sourceRef, test_ref: args.testRef, at }
    const next = mergeBaseline(baseline, now, meta)
    fs.mkdirSync(path.dirname(baselineFile), { recursive: true })
    fs.writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    appendHistory(abs(args.history), historyRow(now, meta))
    console.log(`Đã cập nhật ${args.baseline}:\n${JSON.stringify(next, null, 2)}`)
    summary(`### Coverage baseline\n\n${table(compare(next, now, args.tolerance))}`)
    return 0
  }

  const rows = compare(baseline, now, args.tolerance)
  if (!rows.length) {
    console.error(`Baseline ${args.baseline} không có chỉ số nào trùng với lượt chạy hiện tại — không so được, coi là đỏ.`)
    return 1
  }

  console.log(table(rows))
  summary(`### Cổng coverage (dung sai ${args.tolerance} điểm %)\n\n${table(rows)}`)

  const regressed = rows.filter((r) => r.status === 'regressed')
  const missing = rows.filter((r) => r.status === 'missing')
  for (const r of rows.filter((x) => x.status === 'within-tolerance')) {
    console.warn(`Cảnh báo: \`${r.metric}\` giảm ${Math.abs(r.delta!).toFixed(2)} điểm % (còn trong dung sai ${args.tolerance}).`)
  }
  for (const r of missing) {
    console.error(`\`${r.metric}\` có trong baseline (${r.baseline.toFixed(2)}%) nhưng lượt chạy này không đo được — thiếu dữ liệu, không phải đạt.`)
  }
  if (regressed.length || missing.length) {
    console.error(
      `\nCổng coverage ĐỎ: ${regressed.length} chỉ số tụt quá dung sai ${args.tolerance} điểm %, ${missing.length} chỉ số không đo được.`,
    )
    return 1
  }
  console.log(`\nCổng coverage XANH (dung sai ${args.tolerance} điểm %).`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
