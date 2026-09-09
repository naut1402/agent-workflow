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
 *   - **Neo chỉ được GHI ở đây, không so ở đây.** So neo với head của PR phát
 *     hành là việc của `test-anchor.ts` — nhờ vậy cổng này không cần biết mình
 *     đang chạy ở dòng test hay ở PR phát hành.
 *
 *   bun run coverage:gate -- --check
 *   bun run coverage:gate -- --update --source-ref dev/1.1.3/main --test-ref test/1.1.3/main \
 *     --source-sha "$(git rev-parse HEAD)" --test-sha "$TEST_SHA"
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseJsonObject } from './lib/json.js'

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

const SHA_RE = /^[0-9a-f]{40}$/i

/**
 * SHA neo phải là **hash đầy đủ**; rỗng · viết tắt · không phải hex đều là lỗi.
 *
 * Vì sao chặt: git cho phép viết tắt, nên lưu `abc1234` rồi so bằng `===` ở
 * `test-anchor.ts` sẽ báo "lệch neo" giả. Ghi khoá rỗng còn tệ hơn — cổng neo
 * đọc ra `no-anchor` rồi tưởng đây là baseline cũ trước khi có cơ chế neo.
 * Lượt chạy không có neo thì **bỏ hẳn cờ**, không truyền chuỗi rỗng.
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

/** Baseline phải parse được **và** có ít nhất một chỉ số — nửa vời thì cổng vô nghĩa. */
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

export interface BaselineMeta {
  source_ref?: string
  test_ref?: string
  source_sha?: string
  test_sha?: string
  at?: string
}

/**
 * Baseline mới = max(cũ, mới) từng chỉ số. Không bao giờ hạ.
 *
 * ⚠️ **Neo thì ngược lại: ghi đè, không `max()`.** Neo là *thời điểm*, và
 * `max()` trên chuỗi SHA là vô nghĩa — lượt mới nhất thắng.
 *
 * Khoá lạ do tooling khác ghi vẫn còn sau khi ghi (round-trip không được làm
 * mất dữ liệu của người khác), nên `out` bắt đầu từ chính `baseline`.
 */
/**
 * Neo là khoá **đã biết**, nên xử lý tường minh chứ 🚫 không để nó sống sót nhờ
 * `{ ...baseline }`. Lượt ghi số mà không khai neo thì neo cũ **không còn mô tả**
 * số mới: giữ lại là để `test-anchor.ts` so head PR với một cây khác rồi in "neo
 * khớp" — đúng loại xanh giả mà epic này dựng ra để diệt. Bỏ neo ⇒ verdict
 * `no-anchor`, tức một cảnh báo **nhìn thấy được**, không phải một kết luận sai.
 *
 * Hai khoá xử lý độc lập: khai nửa neo thì nửa còn lại cũng không còn đúng.
 */
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

export function mergeBaseline(baseline: Baseline, now: Measured, meta: BaselineMeta): Baseline {
  const frontend: Partial<Record<FeMetric, number>> = { ...(baseline.frontend ?? {}) }
  for (const m of FE_METRICS) {
    const cur = now.frontend[m]
    if (cur === undefined) continue
    frontend[m] = Math.max(frontend[m] ?? 0, cur)
  }
  const backend = { ...(baseline.backend ?? {}) }
  if (now.backend.lines !== undefined) backend.lines = Math.max(backend.lines ?? 0, now.backend.lines)

  const out: Baseline = { ...baseline, updated_at: meta.at ?? new Date().toISOString() }
  if (Object.keys(frontend).length) out.frontend = frontend
  if (Object.keys(backend).length) out.backend = backend
  if (meta.source_ref) out.source_ref = meta.source_ref
  if (meta.test_ref) out.test_ref = meta.test_ref
  applyAnchor(out, baseline, meta)
  return out
}

/** ⚠️ Giữ đúng 5 cột: thêm SHA vào log cho người là đổi mọi dòng cũ (ngoài phạm vi). */
export function historyRow(now: Measured, meta: BaselineMeta): string {
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
  sourceSha?: string
  testSha?: string
  allowMissing: boolean
  tolerance: number
}

/**
 * Bảng cờ khai báo thay cho chuỗi `else if`: cổng này nhận thêm cờ ở mỗi đợt
 * của mô hình tách test, mà mỗi `else if` lại thêm một nhánh vào cùng một hàm.
 *
 * ⚠️ Hai kiểu "thiếu tham số" **không** được sửa cho đều — test đang khoá hành
 * vi này: cờ đường dẫn thiếu giá trị thì giữ default, cờ ref/sha thì `undefined`.
 */
const VALUE_FLAGS: Record<string, (o: Args, v: string | undefined) => void> = {
  '--baseline': (o, v) => (o.baseline = v ?? o.baseline),
  '--fe': (o, v) => (o.fe = v ?? o.fe),
  '--be': (o, v) => (o.be = v ?? o.be),
  '--history': (o, v) => (o.history = v ?? o.history),
  '--source-ref': (o, v) => (o.sourceRef = v),
  '--test-ref': (o, v) => (o.testRef = v),
  '--source-sha': (o, v) => (o.sourceSha = v),
  '--test-sha': (o, v) => (o.testSha = v),
  '--tolerance': (o, v) => (o.tolerance = Number(v) || 0),
}

const BOOL_FLAGS: Record<string, (o: Args) => void> = {
  '--check': (o) => (o.mode = 'check'),
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
    tolerance: TOLERANCE,
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
      'Cách dùng: coverage-gate.ts (--check | --update) [--baseline <path>] [--fe <path>] [--be <path>]\n' +
        '           [--source-ref <ref>] [--test-ref <ref>] [--source-sha <sha40>] [--test-sha <sha40>]',
    )
    return 2
  }

  // Validate neo TRƯỚC khi đọc/ghi gì: SHA sai thì không được ghi baseline nửa vời.
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
    const meta: BaselineMeta = { source_ref: args.sourceRef, test_ref: args.testRef, source_sha: sourceSha, test_sha: testSha, at }
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
