#!/usr/bin/env bun
/**
 * Máy ghi **mốc coverage** của một dòng version, và là nơi duy nhất ghi **neo SHA**.
 *
 * 🚫 Đây KHÔNG còn là cổng. Từ 2026-09-11 mức phủ không gác merge nữa
 * (`docs/agent-rules/testing.md` §6): "nợ test" được định nghĩa là **task đã merge
 * mà dòng test chưa có test cho nó**, và nó được gác theo TASK ở
 * `test-coverage-status.ts --strict`. Phần trăm chỉ được **ghi lại** để người đọc
 * thấy xu hướng — 🚫 đừng dựng lại một cổng theo phần trăm ở đây hay ở chỗ khác.
 *
 * Một chế độ:
 *   --update   ghi mốc = số của lượt này (GHI ĐÈ) + neo + một dòng lịch sử
 *
 * Bất biến còn lại:
 *   - **Không đọc được dữ liệu coverage nào là lỗi** (exit 1). Đây là ràng buộc về
 *     *dữ liệu* — "lượt chạy có thật sự đo không" — 🚫 không phải về mức phủ, nên
 *     nó không đi cùng cổng.
 *   - **Thiếu baseline là lỗi**, trừ khi khai `--allow-missing`: sai đường dẫn
 *     `--baseline` 🚫 không được âm thầm tạo một file mới.
 *   - Baseline sai định dạng là lỗi — 🚫 không suy ra 0% rồi ghi tiếp.
 *   - **Neo chỉ được GHI ở đây, không so ở đây.** So neo với head của PR phát
 *     hành là việc của `test-anchor.ts` — nhờ vậy file này không cần biết mình
 *     đang chạy ở dòng test hay ở PR phát hành.
 *
 *   bun run coverage:gate -- --update --source-ref dev/1.1.3/main --test-ref test/1.1.3/main \
 *     --source-sha "$(git rev-parse HEAD)" --test-sha "$TEST_SHA"
 */
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

/** Baseline phải parse được **và** có ít nhất một chỉ số — nửa vời thì mốc vô nghĩa. */
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

/**
 * So mốc trước với lượt này — **để hiển thị**. 🚫 Không phán quyết: từ 2026-09-11
 * mức phủ không còn là cổng (`testing.md` §6), nợ test gác theo task ở
 * `test-coverage-status.ts`. Vì vậy 🚫 không còn cột kết luận và 🚫 không còn dung sai.
 *
 * Lấy **hợp** của hai phía, 🚫 không chỉ lấy khoá có ở baseline: chỉ số mới xuất
 * hiện ở lượt chạy cũng là thông tin, mà mốc thì không còn là "hợp đồng" để đòi hỏi.
 */
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

/**
 * Mốc mới = số của **lượt này**. 🚫 Không `max()` nữa: từ 2026-09-11 baseline là
 * **mốc tham chiếu**, không phải ngưỡng, nên "chỉ đi lên" sẽ làm nó mô tả một lượt
 * chạy đã không còn tồn tại — và chính bất biến đó đẻ ra quy trình sửa file bằng
 * tay (#310). Chỉ số lượt này 🚫 không đo được thì **giữ giá trị cũ** (không xoá):
 * lượt chạy thiếu dữ liệu đã có cảnh báo riêng ở `main()`.
 *
 * ⚠️ Neo vẫn xử lý tường minh qua `applyAnchor` — nó 🚫 KHÔNG đổi nghĩa: nó vẫn
 * trả lời "suite đã xanh trên cây nào".
 *
 * Khoá lạ do tooling khác ghi vẫn còn sau khi ghi (round-trip không được làm mất
 * dữ liệu của người khác), nên `out` bắt đầu từ chính `baseline`.
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

/** ⚠️ Giữ đúng 5 cột: thêm SHA vào log cho người là đổi mọi dòng cũ (ngoài phạm vi). */
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

/** 4 cột, 🚫 không cột kết luận — không còn dung sai nào để phân loại. */
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
  /**
   * 🚫 Vẫn **bắt buộc khai** `--update`, dù chỉ còn một chế độ: gọi trần không
   * được phép ghi đè file mốc.
   */
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

/**
 * Bảng cờ khai báo thay cho chuỗi `else if`: file này nhận thêm cờ ở mỗi đợt
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
}

/**
 * 🚫 `--check` cố ý KHÔNG có mặt ở đây. Nó là cổng mức phủ, đã bị bỏ 2026-09-11
 * (`testing.md` §6). Cờ không khai báo thì rơi xuống `VALUE_FLAGS[a]?.()` → no-op,
 * nên `--check` trần cho `mode = null` ⇒ exit 2 kèm *Cách dùng*, 🚫 không âm thầm
 * chạy như `--update`. Thêm lại nó là dựng lại cổng — đọc `testing.md` §6 trước.
 */
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
        'Chạy `bun run test:fe` (frontend) và `bun run test -- --coverage` (backend) trước khi ghi mốc.',
    )
    return 1
  }

  // Vùng chưa đo được phải nói ra, không im lặng ghi nửa cây test (TC-D8). Mốc
  // "pha trộn hai lượt" 🚫 không còn nguy hiểm vì nó không phán quyết gì, nhưng
  // đọc một con số backend của lượt trước mà tưởng là của lượt này thì vẫn sai.
  if (now.backend.lines === undefined) {
    console.warn(`Cảnh báo: không có dữ liệu coverage backend (${args.be}) — lượt này chỉ ghi lại mốc của vùng frontend.`)
  }

  let baseline: Baseline
  if (!fs.existsSync(baselineFile)) {
    if (!args.allowMissing) {
      // Vẫn là lỗi: sai đường dẫn `--baseline` 🚫 không được âm thầm tạo file mới.
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
  // ⚠️ Tính Δ TRƯỚC khi ghi đè: sau `mergeBaseline` thì mốc == lượt này, bảng in
  // toàn `+0.00`. Cái người đọc cần là "so với mốc trước", không phải so với chính nó.
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
