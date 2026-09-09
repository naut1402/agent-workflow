#!/usr/bin/env bun
/**
 * Trạng thái test **theo từng task** của một version — cổng phát hành hiện có
 * chỉ biết dòng test *tồn tại / rỗng* ở mức version, nên "version có 12 task,
 * test viết cho 9" là một trạng thái không ai đọc ra được.
 *
 * Cách suy: đối xứng hai dòng branch, cả hai lấy mốc ở nhánh đã release.
 *
 *   dòng source:  origin/main       .. dev/<version>/main   → task ĐÃ MERGE
 *   dòng test:    origin/test/main  .. test/<version>/main   → task ĐÃ CÓ TEST
 *
 * Nguồn định danh task là **subject commit** (`[T0313a84c] feat(ci): …`) —
 * format bắt buộc ở `docs/agent-rules/git-pr.md` §7. Không có bảng tra
 * task↔branch nào để đối chiếu, nên commit không mang định danh phải được **nêu
 * ra** (`untagged`), không im lặng bỏ: im lặng bỏ đúng là loại xanh giả mà epic
 * tách test đang diệt.
 *
 * Miễn trừ (`tests/exemptions.json`) là bề mặt cứng cho task cố ý không cần
 * test. Ba mệnh đề bắt buộc: người duyệt **thấy được lý do** · task được miễn
 * **không** làm cổng đỏ · 🚫 **không** miễn cả version (không wildcard, không
 * khoá cấp version — `version` là field bắt buộc và phải khớp version đang chấm).
 *
 * Đợt đầu là **báo cáo**: mặc định exit 0 kèm ⚠️. `--strict` biến "còn task
 * thiếu test" thành đỏ — siết cổng về sau là thêm một cờ, không sửa lại script.
 * 🚫 exit 0 ở đây **không** có nghĩa "đã đủ test".
 *
 *   bun run test:status -- --version 1.1.4
 *   bun run test:status -- --version 1.1.4 --source-ref "$PR_HEAD_SHA" --strict
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseJsonObject } from './lib/json.js'
import { testLineOf, versionOf } from './test-ref.js'

const ROOT = path.resolve(import.meta.dir, '..', '..')

export const EXEMPTIONS_FILE = 'tests/exemptions.json'

/** Lý do một chữ ("wip", "n/a") không phải lý do — người duyệt không quyết được gì với nó. */
export const MIN_REASON = 10

/** Đúng regex định danh task của `git-pr.md` §7; phần sau (`feat(ci): …`, hậu tố `(#123)` của squash) không ảnh hưởng. */
const TASK_RE = /^\[([A-Za-z0-9][A-Za-z0-9-]*)\]\s/
const REVERT_RE = /^Revert\s+"(.+)"\s*$/
const TYPE_RE = /^\[[^\]]+\]\s+([a-z]+)(?:\([^)]*\))?!?:/

export function taskIdOf(subject: string): string | null {
  return TASK_RE.exec(subject)?.[1] ?? null
}

/**
 * Bóc mọi lớp `Revert "…"` lồng nhau, trả về subject gốc + số lớp.
 *
 * Cần **số lớp**, không chỉ cần biết "có phải revert": revert của một revert là
 * **khôi phục**. Lớp lẻ ⇒ subject gốc đang bị huỷ, lớp chẵn ⇒ đang sống lại.
 * Chỉ đếm "có commit revert" thì ca re-revert bị đọc thành "đã revert" ⇒ cổng
 * miễn test cho code đang sống.
 */
export function unwrapRevert(subject: string): { base: string; depth: number } {
  let base = subject.trim()
  let depth = 0
  for (;;) {
    const inner = REVERT_RE.exec(base)?.[1]?.trim()
    if (!inner) return { base, depth }
    base = inner
    depth += 1
  }
}

/**
 * Commit revert do GitHub tạo mang subject `Revert "<subject gốc>"`, nên định
 * danh task nằm **bên trong** dấu ngoặc kép. Không bóc ra thì công việc đã bị
 * revert vẫn bị đòi test, và bản thân commit revert lại rơi vào `untagged`.
 */
export function revertedTaskIdOf(subject: string): string | null {
  const { base, depth } = unwrapRevert(subject)
  return depth > 0 ? taskIdOf(base) : null
}

/** `feat` · `docs` · `chore` … — chỉ để **hiện** ứng viên miễn trừ, 🚫 không tự động miễn. */
export function typeOf(subject: string): string | null {
  return TYPE_RE.exec(subject)?.[1] ?? null
}

export interface Exemption {
  taskId: string
  version: string
  reason: string
  approved_by: string
}

const REQUIRED = ['taskId', 'version', 'reason', 'approved_by'] as const

/**
 * Bất biến: **sai định dạng là ĐỎ**, không phải "coi như không có miễn trừ".
 * Fallback im lặng theo chiều nào cũng là kết luận âm thầm, mà đây đúng là chỗ
 * người ta sẽ thử nới cổng.
 */
/** Bốn field bắt buộc, đủ và không rỗng — miễn trừ khuyết không được chấp nhận. */
function requireFields(rec: Record<string, unknown>, at: string): Exemption {
  for (const k of REQUIRED) {
    const v = rec[k]
    if (typeof v !== 'string' || !v.trim()) {
      throw new Error(`${at} thiếu field bắt buộc "${k}" (chuỗi không rỗng) — miễn trừ khuyết không được chấp nhận.`)
    }
  }
  return {
    taskId: String(rec.taskId).trim(),
    version: String(rec.version).trim(),
    reason: String(rec.reason).trim(),
    approved_by: String(rec.approved_by).trim(),
  }
}

/** Một entry hợp lệ: đúng định danh task, đúng một version, lý do người đọc được. */
function parseEntry(item: unknown, at: string): Exemption {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${at} phải là object.`)
  const e = requireFields(item as Record<string, unknown>, at)

  // Chặn miễn cả version: wildcard là cách âm thầm tắt cổng cho toàn bộ dòng.
  if (e.taskId.includes('*') || !TASK_RE.test(`[${e.taskId}] x: y`)) {
    throw new Error(`${at} có taskId "${e.taskId}" không phải định danh task — 🚫 không miễn trừ cấp version, không wildcard.`)
  }
  if (e.version.includes('*')) {
    throw new Error(`${at} có version "${e.version}" dạng wildcard — 🚫 miễn trừ phải khai đúng một version.`)
  }
  if (e.reason.length < MIN_REASON) {
    throw new Error(`${at} có reason quá ngắn ("${e.reason}") — người duyệt phải đọc được vì sao task này không cần test.`)
  }
  return e
}

export function parseExemptions(raw: string, file: string): Exemption[] {
  const parsed = parseJsonObject(raw, file)

  const list = parsed.exemptions
  if (list === undefined) throw new Error(`${file} thiếu khoá "exemptions" (mảng, được phép rỗng).`)
  if (!Array.isArray(list)) throw new Error(`${file} khoá "exemptions" phải là mảng.`)

  const out: Exemption[] = []
  const seen = new Map<string, number>()
  list.forEach((item, idx) => {
    const at = `${file} entry #${idx + 1}`
    const e = parseEntry(item, at)

    const key = `${e.taskId}@${e.version}`
    const dup = seen.get(key)
    if (dup !== undefined) {
      throw new Error(`${at} trùng với entry #${dup} (${key}) — hai miễn trừ cho cùng một task thì không biết cái nào có hiệu lực.`)
    }
    seen.set(key, idx + 1)
    out.push(e)
  })
  return out
}

export interface TaskEntry {
  taskId: string
  subjects: string[]
  types: string[]
}

export interface StatusReport {
  /** Task có commit ở dòng source trong khoảng đang chấm. */
  merged: TaskEntry[]
  /** Task có commit ở dòng test — `Set` để tra nhanh; căn cứ chi tiết ở `testedDetail`. */
  tested: Set<string>
  /** Căn cứ của kết luận "đã có test": chính commit ở dòng test. */
  testedDetail: TaskEntry[]
  /** Miễn trừ **áp dụng** cho version đang chấm. */
  exempt: Exemption[]
  /** `merged − tested − exempt − reverted`. */
  missing: TaskEntry[]
  /** Subject không mang định danh task — không quy được về task nào. */
  untagged: string[]
  /** Miễn trừ của version khác — nêu ra, **không** áp dụng. */
  staleExempt: Exemption[]
  /** Task mà **mọi** commit đều đã bị revert — không đòi test. */
  reverted: TaskEntry[]
  /**
   * Task bị revert **một phần**: có commit đã revert nhưng vẫn còn commit sống.
   * Vẫn nằm trong `missing` — đây là chỗ mà "có revert ⇒ miễn test" cho xanh giả.
   */
  partialRevert: Set<string>
  /** Miễn trừ trỏ tới task không có trên dòng version — rác cần dọn. */
  orphanExempt: Exemption[]
}

/**
 * Revert được cân bằng ở mức **subject**, không ở mức task.
 *
 * Vì sao: gom vào một `Set` theo taskID thì task 3 commit mà chỉ 1 commit bị
 * revert cũng bị coi là "đã revert" ⇒ hai commit còn sống trên dòng version
 * không bị đòi test nữa, và báo cáo đóng bằng dấu ✅. Đúng loại xanh giả mà
 * `TC-E6` sinh ra để chặn.
 *
 * Lớp lẻ = huỷ (+1), lớp chẵn = khôi phục (−1); tổng > 0 mới là "đang bị revert".
 */
/** Ba loại subject mà `collect` cần phân biệt — tách ra để chỗ gom không phải vừa phân loại vừa cộng dồn. */
type Classified =
  | { kind: 'revert'; base: string; delta: number }
  | { kind: 'task'; id: string; subject: string }
  | { kind: 'untagged'; subject: string }

function classifySubject(subject: string): Classified {
  const { base, depth } = unwrapRevert(subject)
  if (depth > 0) {
    // Revert của commit không mang định danh task thì cũng không quy được về
    // task nào — nêu ra như commit thường, 🚫 không bỏ qua im lặng.
    return taskIdOf(base) ? { kind: 'revert', base, delta: depth % 2 === 1 ? 1 : -1 } : { kind: 'untagged', subject }
  }
  const id = taskIdOf(subject)
  return id ? { kind: 'task', id, subject } : { kind: 'untagged', subject }
}

/** E13: một task nhiều commit vẫn tính MỘT task, nhưng giữ đủ subject làm căn cứ. */
function addTaskCommit(byId: Map<string, TaskEntry>, id: string, subject: string): void {
  const entry = byId.get(id) ?? { taskId: id, subjects: [], types: [] }
  entry.subjects.push(subject)
  const type = typeOf(subject)
  if (type && !entry.types.includes(type)) entry.types.push(type)
  byId.set(id, entry)
}

function collect(subjects: string[]): { tasks: TaskEntry[]; untagged: string[]; revertedSubjects: Set<string> } {
  const byId = new Map<string, TaskEntry>()
  const untagged: string[] = []
  const balance = new Map<string, number>()

  for (const raw of subjects) {
    const subject = raw.trim()
    if (!subject) continue

    const c = classifySubject(subject)
    if (c.kind === 'untagged') untagged.push(c.subject)
    else if (c.kind === 'revert') balance.set(c.base, (balance.get(c.base) ?? 0) + c.delta)
    else addTaskCommit(byId, c.id, c.subject)
  }

  const revertedSubjects = new Set([...balance].filter(([, n]) => n > 0).map(([subject]) => subject))
  // Thứ tự xác định: báo cáo phải diff/dán được vào PR, không đổi giữa hai lượt.
  return { tasks: [...byId.values()].sort((a, b) => a.taskId.localeCompare(b.taskId)), untagged, revertedSubjects }
}

export function computeStatus(input: {
  sourceSubjects: string[]
  testSubjects: string[]
  exemptions: Exemption[]
  version: string
}): StatusReport {
  const source = collect(input.sourceSubjects)
  const test = collect(input.testSubjects)

  const exempt = input.exemptions.filter((e) => e.version === input.version)
  const staleExempt = input.exemptions.filter((e) => e.version !== input.version)
  const exemptIds = new Set(exempt.map((e) => e.taskId))
  const tested = new Set(test.tasks.map((t) => t.taskId))

  // Chỉ miễn test khi KHÔNG còn commit nào sống. Còn một commit sống thì task
  // vẫn phải có test — và được gắn nhãn `partialRevert` để người duyệt biết vì sao.
  const isReverted = (s: string) => source.revertedSubjects.has(s)
  const reverted = source.tasks.filter((t) => t.subjects.every(isReverted))
  const revertedIds = new Set(reverted.map((t) => t.taskId))
  const partialRevert = new Set(
    source.tasks.filter((t) => !revertedIds.has(t.taskId) && t.subjects.some(isReverted)).map((t) => t.taskId),
  )

  const mergedIds = new Set(source.tasks.map((t) => t.taskId))
  const orphanExempt = exempt.filter((e) => !mergedIds.has(e.taskId))

  return {
    merged: source.tasks,
    tested,
    testedDetail: test.tasks,
    exempt,
    missing: source.tasks.filter((t) => !tested.has(t.taskId) && !exemptIds.has(t.taskId) && !revertedIds.has(t.taskId)),
    untagged: source.untagged,
    staleExempt,
    reverted,
    partialRevert,
    orphanExempt,
  }
}

export interface RenderOpts {
  version: string
  strict: boolean
  /** Dòng test chưa mở ⇒ mọi task vào `missing` vì lý do khác hẳn "quên viết test". */
  testLineMissing?: boolean
  /** Chưa có `test/main` để làm mốc ⇒ khoảng đếm ở dòng test rộng hơn thực tế. */
  noTestTrunk?: boolean
  /** `dev/<version>/main` chưa có trên origin ⇒ lượt này đếm trên `HEAD`, không phải dòng version. */
  sourceFallback?: boolean
  sourceRange?: string
  testRange?: string
}

function taskRow(t: TaskEntry, note: string): string {
  const types = t.types.length ? t.types.map((x) => `\`${x}\``).join(' ') : '—'
  return `| \`${t.taskId}\` | ${types} | ${t.subjects.length} | ${note} |`
}

/** Khoảng commit đã đọc — người đọc phải kiểm chứng được kết luận, không chỉ tin con số. */
function sectionRanges(opts: RenderOpts): string[] {
  if (!opts.sourceRange && !opts.testRange) return []
  const lines = ['| Dòng | Khoảng commit đã đọc |', '|---|---|']
  if (opts.sourceRange) lines.push(`| source | \`${opts.sourceRange}\` |`)
  lines.push(`| test | ${opts.testRange ? `\`${opts.testRange}\`` : '— **chưa có dòng test**'} |`)
  return [...lines, '']
}

/** Hai ca khuyết dữ liệu phải nói ra lý do, nếu không "thiếu test" bị đọc sai nguyên nhân. */
function sectionCaveats(opts: RenderOpts): string[] {
  const lines: string[] = []
  if (opts.testLineMissing) {
    lines.push(
      `⚠️ **Dòng test của version \`${opts.version}\` chưa mở** — mọi task dưới đây là "chưa có test" vì`,
      'chưa có dòng test nào để đối chiếu, không phải vì từng task bị bỏ sót.',
      'Cổng chặn cứng ca này nằm ở `release-test-gate.yml` (job `probe`).',
      '',
    )
  }
  if (opts.noTestTrunk) {
    lines.push(
      '⚠️ **Chưa có `test/main` để làm mốc** — khoảng đếm ở dòng test là toàn bộ lịch sử của nó,',
      'nên số task "đã có test" có thể rộng hơn thực tế.',
      '',
    )
  }
  if (opts.sourceFallback) {
    lines.push(
      `⚠️ **\`dev/${opts.version}/main\` chưa có trên origin** — lượt này đếm trên \`HEAD\` (cây đang`,
      'đứng), **không phải** dòng version. Báo cáo vẫn mang tên version nên đừng đọc nó như đã',
      'chấm dòng version; truyền `--source-ref <ref|sha>` nếu muốn chỉ định tường minh.',
      '',
    )
  }
  return lines
}

function sectionCounts(r: StatusReport): string[] {
  const testedCount = r.merged.filter((t) => r.tested.has(t.taskId)).length
  return [
    '| Nhóm | Số task |',
    '|---|---|',
    `| đã merge ở dòng source | ${r.merged.length} |`,
    `| đã có test | ${testedCount} |`,
    `| **thiếu test** | **${r.missing.length}** |`,
    `| miễn trừ (áp dụng version này) | ${r.exempt.length} |`,
    `| đã revert (mọi commit) | ${r.reverted.length} |`,
    `| commit không truy được task | ${r.untagged.length} |`,
    '',
  ]
}

function sectionMissing(r: StatusReport, opts: RenderOpts): string[] {
  if (!r.merged.length) {
    return [
      `⚠️ **Không có task nào** merge vào dòng version \`${opts.version}\` trong khoảng đã đọc.`,
      '🚫 Đây **không** phải "đã đủ test" — 0 task nghĩa là không có gì để chấm.',
      '',
    ]
  }
  if (!r.missing.length) return []

  const note = (t: TaskEntry) =>
    r.partialRevert.has(t.taskId)
      ? '⚠️ revert **một phần** — vẫn còn commit sống, vẫn cần test'
      : 'chưa thấy commit nào ở dòng test'

  const lines = [
    `### ❗ ${r.missing.length} task thiếu test`,
    '',
    '| Task | Type commit | Số commit | Ghi chú |',
    '|---|---|---|---|',
    ...r.missing.map((t) => taskRow(t, note(t))),
    '',
    'Cột **type commit** để người duyệt thấy ngay task nào chỉ có `docs`/`chore` — ứng viên miễn trừ.',
    `🚫 Cổng **không** tự miễn theo type: một \`chore\` vẫn sửa được code. Khai miễn trừ ở \`${EXEMPTIONS_FILE}\`.`,
    '',
  ]
  for (const t of r.missing) {
    lines.push(`<details><summary><code>${t.taskId}</code> — ${t.subjects.length} commit</summary>`, '')
    lines.push(...t.subjects.map((x) => `- ${x}`))
    lines.push('', '</details>', '')
  }
  return lines
}

/** Kết luận "đã có test" phải kèm căn cứ — chính commit ở dòng test, không chỉ chữ OK. */
function sectionTested(r: StatusReport): string[] {
  if (!r.testedDetail.length) return []
  return [
    '### ✅ Task đã có test — kèm căn cứ',
    '',
    '| Task | Commit ở dòng test |',
    '|---|---|',
    ...r.testedDetail.map((t) => `| \`${t.taskId}\` | ${t.subjects.map((x) => `\`${x}\``).join('<br>')} |`),
    '',
  ]
}

function sectionExempt(r: StatusReport, opts: RenderOpts): string[] {
  const lines: string[] = []
  if (r.exempt.length) {
    lines.push(
      '### 🟡 Miễn trừ đang áp dụng',
      '',
      '| Task | Người duyệt | Lý do |',
      '|---|---|---|',
      ...r.exempt.map((e) => `| \`${e.taskId}\` | ${e.approved_by} | ${e.reason} |`),
      '',
    )
  }
  if (r.orphanExempt.length) {
    lines.push(
      `⚠️ **Miễn trừ mồ côi** (task không có trên dòng version \`${opts.version}\` — dọn khỏi \`${EXEMPTIONS_FILE}\`): ` +
        r.orphanExempt.map((e) => `\`${e.taskId}\``).join(' · '),
      '',
    )
  }
  // Miễn trừ của version khác tích lại theo từng release, nên chỉ đếm — liệt kê
  // từng entry biến mục này thành một dòng dài dằng dặc về task không liên quan.
  if (r.staleExempt.length) {
    lines.push(
      `⚠️ **${r.staleExempt.length} miễn trừ của version khác — KHÔNG áp dụng ở lượt này.** ` +
        `Miễn trừ của version đã release nên được dọn khỏi \`${EXEMPTIONS_FILE}\`.`,
      '',
    )
  }
  return lines
}

function sectionReverted(r: StatusReport): string[] {
  if (!r.reverted.length) return []
  return [
    '### ↩️ Task đã revert — không đòi test',
    '',
    '| Task | Type commit | Số commit | Ghi chú |',
    '|---|---|---|---|',
    ...r.reverted.map((t) => taskRow(t, '**mọi** commit đều có `Revert "…"` trên dòng source')),
    '',
  ]
}

function sectionUntagged(r: StatusReport): string[] {
  if (!r.untagged.length) return []
  return [
    `### ⚠️ ${r.untagged.length} commit không truy được task`,
    '',
    'Subject không mang `[<taskID>]` nên không quy được về task nào. `git-pr.md` §7 **cho phép** bỏ',
    'định danh task, nên đây 🚫 không tính là thiếu test và cũng 🚫 không phải sai format —',
    'nhưng cũng không bỏ qua im lặng: người duyệt tự xác nhận những commit này không cần test.',
    '',
    ...r.untagged.map((x) => `- ${x}`),
    '',
  ]
}

/**
 * ⚠️ Không có task nào thì KHÔNG được đóng bằng dấu ✅: 0 task nghĩa là không có
 * gì để chấm, mà "chọn ra 0 thứ" chưa bao giờ là "đã xanh".
 */
function closingLine(r: StatusReport, opts: RenderOpts): string {
  if (r.missing.length) {
    return opts.strict
      ? `❌ **CHẶN** (\`--strict\`): còn ${r.missing.length} task thiếu test.`
      : `⚠️ Còn ${r.missing.length} task thiếu test. Lượt này là **báo cáo** (exit 0) — 🚫 exit 0 ở đây **không** phải "đã đủ test".`
  }
  if (r.merged.length) return '✅ Mọi task đã merge đều có test (hoặc được miễn trừ tường minh / đã revert) trong khoảng đã đọc.'
  return `⚠️ Không có task nào để chấm ở version \`${opts.version}\` — chưa kết luận được gì về độ phủ.`
}

export function renderStatus(r: StatusReport, opts: RenderOpts): string {
  return [
    `## Trạng thái test theo task — version \`${opts.version}\``,
    '',
    ...sectionRanges(opts),
    ...sectionCaveats(opts),
    ...sectionCounts(r),
    ...sectionMissing(r, opts),
    ...sectionTested(r),
    ...sectionExempt(r, opts),
    ...sectionReverted(r),
    ...sectionUntagged(r),
    closingLine(r, opts),
  ].join('\n')
}

interface Args {
  version?: string
  sourceRef?: string
  exemptions: string
  strict: boolean
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { exemptions: EXEMPTIONS_FILE, strict: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--strict') out.strict = true
    else if (a === '--version') out.version = argv[++i]
    else if (a === '--source-ref') out.sourceRef = argv[++i]
    else if (a === '--exemptions') out.exemptions = argv[++i] ?? out.exemptions
  }
  return out
}

interface GitResult {
  ok: boolean
  out: string
}

/**
 * `repo` là tham số chứ không phải `ROOT` cố định: nguồn sự thật của lệnh này
 * là lịch sử commit của hai dòng branch, nên test phải dựng được repo + origin
 * tạm với commit/branch thật thay vì mock lại `git log`.
 */
function git(repo: string, ...args: string[]): GitResult {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() }
}

function summary(text: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY
  if (f) fs.appendFileSync(f, `${text}\n`)
}

class ToolError extends Error {}

/**
 * Kết luận ĐỎ của cổng (exit 1) — tách hẳn khỏi `ToolError` (exit 2, "cổng không
 * đọc được dữ liệu"). Nhờ hai lớp lỗi này `main()` chỉ còn một `try` duy nhất mà
 * vẫn giữ nguyên contract exit code đã ghi trong `testing.md` §3.1.
 */
class GateError extends Error {}

/**
 * Ref dùng được ở local — có sẵn thì dùng, thiếu thì hỏi remote **rồi mới** kết luận.
 *
 * Ba kết quả phải tách bạch (bất biến `testing.md` §3.1): ref có · ref **chưa
 * tồn tại** · **không kéo được** (mất mạng / mất quyền). Trộn hai ca cuối là
 * đọc "không kéo được dòng test" thành "thiếu test".
 */
function resolveRef(repo: string, ref: string): string | null {
  const local = git(repo, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}`)
  if (local.ok && local.out) return `origin/${ref}`

  const probe = spawnSync('git', ['ls-remote', '--exit-code', 'origin', `refs/heads/${ref}`], { cwd: repo, encoding: 'utf8' })
  if (probe.status === 2) return null
  if (probe.status !== 0) {
    throw new ToolError(
      `Không kéo được ref \`${ref}\` từ origin (git ls-remote thoát ${probe.status}).\n` +
        'Đây KHÔNG phải "thiếu test" — sửa mạng/quyền rồi chạy lại.',
    )
  }
  if (!git(repo, 'fetch', '--no-tags', '--quiet', 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`).ok) {
    throw new ToolError(`Không fetch được \`${ref}\` dù remote có ref này — KHÔNG phải "thiếu test". Chạy lại sau khi sửa mạng/quyền.`)
  }
  return `origin/${ref}`
}

function subjectsOf(repo: string, range: string): string[] {
  const r = git(repo, 'log', '--no-merges', '--pretty=%s', range)
  if (!r.ok) throw new ToolError(`Không đọc được lịch sử \`${range}\` — thiếu lịch sử trong workspace? (CI cần \`fetch-depth: 0\`).`)
  return r.out.split('\n').filter(Boolean)
}

function readExemptions(repo: string, file: string): Exemption[] {
  const abs = path.isAbsolute(file) ? file : path.join(repo, file)
  // E8: đa số version không có miễn trừ nào — thiếu file là hợp lệ, không phải lỗi.
  if (!fs.existsSync(abs)) return []
  try {
    return parseExemptions(fs.readFileSync(abs, 'utf8'), file)
  } catch (e) {
    // Miễn trừ sai định dạng là ĐỎ: đây là chỗ người ta sẽ thử nới cổng.
    throw new GateError(e instanceof Error ? e.message : String(e))
  }
}

interface Scope {
  sourceRange: string
  testRange: string | null
  testLineMissing: boolean
  noTestTrunk: boolean
  /** `dev/<version>/main` không có trên origin ⇒ đã phải đếm trên `HEAD`, không phải dòng version. */
  sourceFallback: boolean
}

/**
 * Hai khoảng đối xứng để đếm, cả hai neo ở nhánh đã release. Tách khỏi `main()`
 * vì đây là phần duy nhất hỏi remote — ba ca (`có` / `chưa tồn tại` / `không kéo
 * được`) phải tách bạch, còn `main()` chỉ nối dây và chọn exit code.
 */
function resolveScope(repo: string, version: string, sourceRef: string | undefined): Scope {
  const mainRef = resolveRef(repo, 'main')
  if (!mainRef) throw new ToolError('Không thấy `main` trên origin — không có mốc nào để đếm task đã merge.')

  // Biết được là đã fallback thì phải nói ra: `HEAD` là cây đang đứng (branch task),
  // không phải dòng version — báo cáo vẫn mang tiêu đề version nên người đọc dễ tin
  // là đã chấm trên dòng version.
  const versionRef = resolveRef(repo, `dev/${version}/main`)
  const sourceHead = sourceRef?.trim() || versionRef || 'HEAD'
  const testLineRef = resolveRef(repo, testLineOf(`dev/${version}/main`))
  const testTrunk = testLineRef ? resolveRef(repo, 'test/main') : null

  return {
    sourceRange: `${mainRef}..${sourceHead}`,
    testRange: testLineRef ? (testTrunk ? `${testTrunk}..${testLineRef}` : testLineRef) : null,
    testLineMissing: !testLineRef,
    noTestTrunk: Boolean(testLineRef && !testTrunk),
    sourceFallback: !sourceRef?.trim() && !versionRef,
  }
}

/** Version của lượt chấm: cờ trước, rồi mới suy từ branch đang đứng. */
function resolveVersion(repo: string, argVersion: string | undefined): string {
  const version = argVersion?.trim() || versionOf(git(repo, 'branch', '--show-current').out)
  if (!version) {
    throw new ToolError(
      'Không suy được version từ branch đang đứng.\n' +
        'Cách dùng: bun run test:status -- --version <x.y.z> [--source-ref <ref|sha>] [--exemptions <path>] [--strict]',
    )
  }
  return version
}

export function main(argv: string[], repo: string = ROOT): number {
  const args = parseArgs(argv)

  if (!git(repo, 'rev-parse', '--git-dir').ok) {
    console.error(`${repo} không phải git repo — lệnh này suy trạng thái từ lịch sử commit của hai dòng branch.`)
    return 2
  }

  try {
    const version = resolveVersion(repo, args.version)
    const exemptions = readExemptions(repo, args.exemptions)
    const scope = resolveScope(repo, version, args.sourceRef)
    const report = computeStatus({
      sourceSubjects: subjectsOf(repo, scope.sourceRange),
      testSubjects: scope.testRange ? subjectsOf(repo, scope.testRange) : [],
      exemptions,
      version,
    })

    const text = renderStatus(report, {
      version,
      strict: args.strict,
      testLineMissing: scope.testLineMissing,
      noTestTrunk: scope.noTestTrunk,
      sourceFallback: scope.sourceFallback,
      sourceRange: scope.sourceRange,
      testRange: scope.testRange ?? undefined,
    })
    console.log(text)
    summary(text)

    if (args.strict && report.missing.length) {
      console.error(`::error::Còn ${report.missing.length} task thiếu test ở version ${version}.`)
      return 1
    }
    return 0
  } catch (e) {
    if (e instanceof GateError) {
      console.error(`::error::${e.message}`)
      return 1
    }
    console.error(e instanceof Error ? e.message : String(e))
    return 2
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
