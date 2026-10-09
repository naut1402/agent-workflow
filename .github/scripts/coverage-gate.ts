#!/usr/bin/env bun
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseJsonObject } from './lib/json.js'

const ROOT = path.resolve(import.meta.dir, '..', '..')

export const FE_METRICS = ['lines', 'statements', 'functions', 'branches'] as const
type FeMetric = (typeof FE_METRICS)[number]

export interface Baseline {
  frontend?: Partial<Record<FeMetric, number>>
  backend?: { lines?: number }
  updated_at?: string
  source_ref?: string
  test_ref?: string
  /** Neo: commit dòng source mà lượt chạy này đo trên. So neo ở `test-anchor.ts`. */
  source_sha?: string
  /** Neo: commit dòng test đã được overlay ở lượt chạy này. */
  test_sha?: string
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

/** `lcov.info` → tỷ lệ dòng tổng (%); `null` khi không có record nào. */
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
  if (!sawRecord || found === 0) return null
  return (hit / found) * 100
}

export function readBackend(file: string): { lines?: number } {
  if (!fs.existsSync(file)) return {}
  const pct = parseLcovLines(fs.readFileSync(file, 'utf8'))
  return pct === null ? {} : { lines: Math.round(pct * 100) / 100 }
}

const SHA_RE = /^[0-9a-f]{40}$/i

/**
 * SHA neo phải là hash đầy đủ (40 hex); rỗng · viết tắt · không phải hex đều ném lỗi.
 * Trả về chữ thường.
 */
export function normalizeSha(value: string | undefined, flag: string): string {
  const v = (value ?? '').trim()
  if (!v) {
    throw new Error(`${flag} rỗng — không lấy được SHA của lượt chạy. Lượt không có neo thì bỏ hẳn cờ, đừng truyền chuỗi rỗng.`)
  }
  if (!SHA_RE.test(v)) {
    throw new Error(`${flag} = "${v}" không phải SHA đầy đủ (40 hex). Lấy bằng \`git rev-parse HEAD\`; SHA viết tắt không dùng được vì cổng neo so bằng chuỗi.`)
  }
  return v.toLowerCase()
}

/** Parse baseline; ném lỗi khi không có chỉ số nào hoặc có chỉ số ngoài 0–100. */
export function parseBaseline(raw: string, file: string): Baseline {
  const b = parseJsonObject(raw, `Baseline ${file}`) as Baseline
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
  /** Mốc đang lưu trong baseline TRƯỚC lượt ghi này. */
  baseline: number | undefined
  current: number | undefined
  delta: number | undefined
}

/** So mốc trước với lượt này để hiển thị, trên hợp khoá của hai phía; không phán quyết. */
export function compare(baseline: Baseline, now: Measured): Row[] {
  const rows: Row[] = []
  const push = (metric: string, base: number | undefined, cur: number | undefined) => {
    if (base === undefined && cur === undefined) return
    rows.push({
      metric,
      baseline: base,
      current: cur,
      delta: base === undefined || cur === undefined ? undefined : cur - base,
    })
  }
  for (const m of FE_METRICS) push(`frontend.${m}`, baseline.frontend?.[m], now.frontend[m])
  push('backend.lines', baseline.backend?.lines, now.backend.lines)
  return rows
}

export interface BaselineMeta {
  source_ref?: string
  test_ref?: string
  source_sha?: string
  test_sha?: string
  at?: string
}

function applyAnchor(out: Baseline, baseline: Baseline, meta: BaselineMeta): void {
  for (const k of ['source_sha', 'test_sha'] as const) {
    if (meta[k]) {
      out[k] = meta[k]
      continue
    }
    if (!baseline[k]) continue
    delete out[k]
    console.warn(
      `Cảnh báo: lượt --update này không khai --${k.replace('_', '-')} — bỏ neo cũ (${baseline[k]}) ` +
        'để cổng neo báo `no-anchor` thay vì so với neo lệch.',
    )
  }
}

/**
 * Mốc mới = số của lượt này; chỉ số không đo được thì giữ giá trị cũ, khoá lạ giữ nguyên.
 * Neo cũ bị bỏ khi lượt này không khai neo tương ứng.
 */
export function mergeBaseline(baseline: Baseline, now: Measured, meta: BaselineMeta): Baseline {
  const frontend: Partial<Record<FeMetric, number>> = { ...(baseline.frontend ?? {}) }
  for (const m of FE_METRICS) {
    const cur = now.frontend[m]
    if (cur === undefined) continue
    frontend[m] = cur
  }
  const backend = { ...(baseline.backend ?? {}) }
  if (now.backend.lines !== undefined) backend.lines = now.backend.lines

  const out: Baseline = { ...baseline, updated_at: meta.at ?? new Date().toISOString() }
  if (Object.keys(frontend).length) out.frontend = frontend
  if (Object.keys(backend).length) out.backend = backend
  if (meta.source_ref) out.source_ref = meta.source_ref
  if (meta.test_ref) out.test_ref = meta.test_ref
  applyAnchor(out, baseline, meta)
  return out
}

/** Một dòng 5 cột cho `coverage-history.md`. */
export function historyRow(now: Measured, meta: BaselineMeta): string {
  const pct = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(2)}%`)
  const at = (meta.at ?? new Date().toISOString()).slice(0, 19).replace('T', ' ')
  return `| ${at} | ${meta.test_ref ?? '—'} | ${meta.source_ref ?? '—'} | ${pct(now.frontend.lines)} | ${pct(now.backend.lines)} |`
}

const HISTORY_HEADER = [
  '# Lịch sử coverage',
  '',
  'Log cho **người đọc**. Sau khi bỏ `max()`, đây là chỗ duy nhất còn lưu các mốc cũ —',
  '`coverage-baseline.json` chỉ giữ mốc của lượt gần nhất. 🚫 Không cổng nào đọc file này.',
  'Mỗi dòng là một lượt CI đã ghi mốc.',
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
    '| Chỉ số | Mốc trước | Lượt này | Δ |',
    '|---|---|---|---|',
    ...rows.map((r) => `| \`${r.metric}\` | ${fmt(r.baseline)} | ${fmt(r.current)} | ${sign(r.delta)} |`),
  ].join('\n')
}

interface Args {
  mode: 'update' | null
  baseline: string
  fe: string
  be: string
  history: string
  sourceRef?: string
  testRef?: string
  sourceSha?: string
  testSha?: string
  allowMissing: boolean
}

const VALUE_FLAGS: Record<string, (o: Args, v: string | undefined) => void> = {
  '--baseline': (o, v) => (o.baseline = v ?? o.baseline),
  '--fe': (o, v) => (o.fe = v ?? o.fe),
  '--be': (o, v) => (o.be = v ?? o.be),
  '--history': (o, v) => (o.history = v ?? o.history),
  '--source-ref': (o, v) => (o.sourceRef = v),
  '--test-ref': (o, v) => (o.testRef = v),
  '--source-sha': (o, v) => (o.sourceSha = v),
  '--test-sha': (o, v) => (o.testSha = v),
}

const BOOL_FLAGS: Record<string, (o: Args) => void> = {
  '--update': (o) => (o.mode = 'update'),
  '--allow-missing': (o) => (o.allowMissing = true),
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    mode: null,
    baseline: 'reports/coverage-baseline.json',
    fe: 'coverage/frontend/coverage-summary.json',
    be: 'coverage/backend/lcov.info',
    history: 'reports/coverage-history.md',
    allowMissing: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const bool = BOOL_FLAGS[a]
    if (bool) {
      bool(out)
      continue
    }
    VALUE_FLAGS[a]?.(out, argv[++i])
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
    console.error(
      'Cách dùng: coverage-gate.ts --update [--allow-missing] [--baseline <path>] [--fe <path>] [--be <path>]\n' +
        '           [--source-ref <ref>] [--test-ref <ref>] [--source-sha <sha40>] [--test-sha <sha40>]\n' +
        '\n' +
        '`--check` đã bị bỏ: mức phủ 🚫 không còn là cổng (docs/agent-rules/testing.md §6).\n' +
        'Nợ test gác theo TASK: `bun run test:status -- --version <x.y.z> --strict`.',
    )
    return 2
  }

  let sourceSha: string | undefined
  let testSha: string | undefined
  try {
    if (args.sourceSha !== undefined) sourceSha = normalizeSha(args.sourceSha, '--source-sha')
    if (args.testSha !== undefined) testSha = normalizeSha(args.testSha, '--test-sha')
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 2
  }

  const baselineFile = abs(args.baseline)
  const now: Measured = { frontend: readFrontend(abs(args.fe)), backend: readBackend(abs(args.be)) }

  if (!Object.keys(now.frontend).length && now.backend.lines === undefined) {
    console.error(
      `Không đọc được dữ liệu coverage nào (${args.fe} · ${args.be}).\n` +
        'Chạy `bun run test:fe` (frontend) và `bun run test -- --coverage` (backend) trước khi ghi mốc.',
    )
    return 1
  }

  if (now.backend.lines === undefined) {
    console.warn(`Cảnh báo: không có dữ liệu coverage backend (${args.be}) — lượt này chỉ ghi lại mốc của vùng frontend.`)
  }

  let baseline: Baseline
  if (!fs.existsSync(baselineFile)) {
    if (!args.allowMissing) {
      console.error(
        `Không thấy baseline ${args.baseline}.\n` +
          'Khởi tạo lần đầu của một dòng test phải khai tường minh:\n' +
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

  const at = new Date().toISOString()
  const meta: BaselineMeta = { source_ref: args.sourceRef, test_ref: args.testRef, source_sha: sourceSha, test_sha: testSha, at }
  const rows = compare(baseline, now)
  const next = mergeBaseline(baseline, now, meta)
  fs.mkdirSync(path.dirname(baselineFile), { recursive: true })
  fs.writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  appendHistory(abs(args.history), historyRow(now, meta))
  console.log(`Đã ghi mốc ${args.baseline}:\n${JSON.stringify(next, null, 2)}`)
  console.log(table(rows))
  summary(
    `### Mốc coverage của version\n\n${table(rows)}\n\n` +
      'Mốc tham chiếu, 🚫 không phải cổng — nợ test gác theo task: `bun run test:status`.',
  )
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
