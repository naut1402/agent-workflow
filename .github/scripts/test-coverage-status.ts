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
 * Commit revert do GitHub tạo mang subject `Revert "<subject gốc>"`, nên định
 * danh task nằm **bên trong** dấu ngoặc kép. Không bóc ra thì công việc đã bị
 * revert vẫn bị đòi test, và bản thân commit revert lại rơi vào `untagged`.
 */
export function revertedTaskIdOf(subject: string): string | null {
  const inner = REVERT_RE.exec(subject)?.[1]
  return inner ? taskIdOf(inner) : null
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
export function parseExemptions(raw: string, file: string): Exemption[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`${file} không phải JSON hợp lệ: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`${file} phải là object JSON có khoá "exemptions".`)

  const list = (parsed as { exemptions?: unknown }).exemptions
  if (list === undefined) throw new Error(`${file} thiếu khoá "exemptions" (mảng, được phép rỗng).`)
  if (!Array.isArray(list)) throw new Error(`${file} khoá "exemptions" phải là mảng.`)

  const out: Exemption[] = []
  const seen = new Map<string, number>()
  list.forEach((item, idx) => {
    const at = `${file} entry #${idx + 1}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${at} phải là object.`)
    const rec = item as Record<string, unknown>

    for (const k of REQUIRED) {
      const v = rec[k]
      if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`${at} thiếu field bắt buộc "${k}" (chuỗi không rỗng) — miễn trừ khuyết không được chấp nhận.`)
      }
    }
    const e: Exemption = {
      taskId: String(rec.taskId).trim(),
      version: String(rec.version).trim(),
      reason: String(rec.reason).trim(),
      approved_by: String(rec.approved_by).trim(),
    }

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
  /** Task có commit revert trên dòng source. */
  reverted: TaskEntry[]
  /** Miễn trừ trỏ tới task không có trên dòng version — rác cần dọn. */
  orphanExempt: Exemption[]
}

function collect(subjects: string[]): { tasks: TaskEntry[]; untagged: string[]; reverted: Set<string> } {
  const byId = new Map<string, TaskEntry>()
  const untagged: string[] = []
  const reverted = new Set<string>()

  for (const s of subjects) {
    const subject = s.trim()
    if (!subject) continue

    const revertedId = revertedTaskIdOf(subject)
    if (revertedId) {
      reverted.add(revertedId)
      continue
    }

    const id = taskIdOf(subject)
    if (!id) {
      untagged.push(subject)
      continue
    }
    // E13: một task nhiều commit vẫn tính MỘT task.
    const entry = byId.get(id) ?? { taskId: id, subjects: [], types: [] }
    entry.subjects.push(subject)
    const type = typeOf(subject)
    if (type && !entry.types.includes(type)) entry.types.push(type)
    byId.set(id, entry)
  }

  // Thứ tự xác định: báo cáo phải diff/dán được vào PR, không đổi giữa hai lượt.
  return { tasks: [...byId.values()].sort((a, b) => a.taskId.localeCompare(b.taskId)), untagged, reverted }
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

  const reverted = source.tasks.filter((t) => source.reverted.has(t.taskId))
  const revertedIds = new Set(reverted.map((t) => t.taskId))

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
  sourceRange?: string
  testRange?: string
}

function taskRow(t: TaskEntry, note: string): string {
  const types = t.types.length ? t.types.map((x) => `\`${x}\``).join(' ') : '—'
  return `| \`${t.taskId}\` | ${types} | ${t.subjects.length} | ${note} |`
}

export function renderStatus(r: StatusReport, opts: RenderOpts): string {
  const lines: string[] = [`## Trạng thái test theo task — version \`${opts.version}\``, '']

  if (opts.sourceRange || opts.testRange) {
    lines.push('| Dòng | Khoảng commit đã đọc |', '|---|---|')
    if (opts.sourceRange) lines.push(`| source | \`${opts.sourceRange}\` |`)
    lines.push(`| test | ${opts.testRange ? `\`${opts.testRange}\`` : '— **chưa có dòng test**'} |`)
    lines.push('')
  }

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

  const testedCount = r.merged.filter((t) => r.tested.has(t.taskId)).length
  lines.push(
    '| Nhóm | Số task |',
    '|---|---|',
    `| đã merge ở dòng source | ${r.merged.length} |`,
    `| đã có test | ${testedCount} |`,
    `| **thiếu test** | **${r.missing.length}** |`,
    `| miễn trừ (áp dụng version này) | ${r.exempt.length} |`,
    `| đã revert | ${r.reverted.length} |`,
    `| commit không truy được task | ${r.untagged.length} |`,
    '',
  )

  if (!r.merged.length) {
    lines.push(
      `⚠️ **Không có task nào** merge vào dòng version \`${opts.version}\` trong khoảng đã đọc.`,
      '🚫 Đây **không** phải "đã đủ test" — 0 task nghĩa là không có gì để chấm.',
      '',
    )
  }

  if (r.missing.length) {
    lines.push(
      `### ❗ ${r.missing.length} task thiếu test`,
      '',
      '| Task | Type commit | Số commit | Ghi chú |',
      '|---|---|---|---|',
      ...r.missing.map((t) => taskRow(t, 'chưa thấy commit nào ở dòng test')),
      '',
      'Cột **type commit** để người duyệt thấy ngay task nào chỉ có `docs`/`chore` — ứng viên miễn trừ.',
      `🚫 Cổng **không** tự miễn theo type: một \`chore\` vẫn sửa được code. Khai miễn trừ ở \`${EXEMPTIONS_FILE}\`.`,
      '',
    )
    for (const t of r.missing) {
      lines.push(`<details><summary><code>${t.taskId}</code> — ${t.subjects.length} commit</summary>`, '')
      lines.push(...t.subjects.map((s) => `- ${s}`))
      lines.push('', '</details>', '')
    }
  }

  if (r.testedDetail.length) {
    lines.push(
      '### ✅ Task đã có test — kèm căn cứ',
      '',
      '| Task | Commit ở dòng test |',
      '|---|---|',
      ...r.testedDetail.map((t) => `| \`${t.taskId}\` | ${t.subjects.map((s) => `\`${s}\``).join('<br>')} |`),
      '',
    )
  }

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
  if (r.staleExempt.length) {
    lines.push(
      '⚠️ **Miễn trừ của version khác — KHÔNG áp dụng ở lượt này**: ' +
        r.staleExempt.map((e) => `\`${e.taskId}\` (version \`${e.version}\`)`).join(' · '),
      '',
    )
  }

  if (r.reverted.length) {
    lines.push(
      '### ↩️ Task đã revert — không đòi test',
      '',
      '| Task | Type commit | Số commit | Ghi chú |',
      '|---|---|---|---|',
      ...r.reverted.map((t) => taskRow(t, 'có commit `Revert "…"` trên dòng source')),
      '',
    )
  }

  if (r.untagged.length) {
    lines.push(
      `### ⚠️ ${r.untagged.length} commit không truy được task`,
      '',
      'Subject không mang `[<taskID>]` nên không quy được về task nào. Không tính là thiếu test,',
      'nhưng cũng 🚫 không bỏ qua im lặng — format commit là việc của `commitlint`.',
      '',
      ...r.untagged.map((s) => `- ${s}`),
      '',
    )
  }

  // ⚠️ Không có task nào thì KHÔNG được đóng bằng dấu ✅: 0 task nghĩa là không
  // có gì để chấm, mà "chọn ra 0 thứ" chưa bao giờ là "đã xanh".
  const closing = r.missing.length
    ? opts.strict
      ? `❌ **CHẶN** (\`--strict\`): còn ${r.missing.length} task thiếu test.`
      : `⚠️ Còn ${r.missing.length} task thiếu test. Lượt này là **báo cáo** (exit 0) — 🚫 exit 0 ở đây **không** phải "đã đủ test".`
    : r.merged.length
      ? '✅ Mọi task đã merge đều có test (hoặc được miễn trừ tường minh / đã revert) trong khoảng đã đọc.'
      : `⚠️ Không có task nào để chấm ở version \`${opts.version}\` — chưa kết luận được gì về độ phủ.`
  lines.push(closing)
  return lines.join('\n')
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
  return parseExemptions(fs.readFileSync(abs, 'utf8'), file)
}

export function main(argv: string[], repo: string = ROOT): number {
  const args = parseArgs(argv)

  if (!git(repo, 'rev-parse', '--git-dir').ok) {
    console.error(`${repo} không phải git repo — lệnh này suy trạng thái từ lịch sử commit của hai dòng branch.`)
    return 2
  }

  const version = args.version?.trim() || versionOf(git(repo, 'branch', '--show-current').out)
  if (!version) {
    console.error(
      'Không suy được version từ branch đang đứng.\n' +
        'Cách dùng: bun run test:status -- --version <x.y.z> [--source-ref <ref|sha>] [--exemptions <path>] [--strict]',
    )
    return 2
  }

  let exemptions: Exemption[]
  try {
    exemptions = readExemptions(repo, args.exemptions)
  } catch (e) {
    // Miễn trừ sai định dạng là ĐỎ: đây là chỗ người ta sẽ thử nới cổng.
    console.error(`::error::${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  const testLine = testLineOf(`dev/${version}/main`)
  try {
    const mainRef = resolveRef(repo, 'main')
    if (!mainRef) throw new ToolError('Không thấy `main` trên origin — không có mốc nào để đếm task đã merge.')
    const sourceHead = args.sourceRef?.trim() || resolveRef(repo, `dev/${version}/main`) || 'HEAD'
    const sourceRange = `${mainRef}..${sourceHead}`

    const testLineRef = resolveRef(repo, testLine)
    const testTrunk = testLineRef ? resolveRef(repo, 'test/main') : null
    const testRange = testLineRef ? (testTrunk ? `${testTrunk}..${testLineRef}` : testLineRef) : null

    const report = computeStatus({
      sourceSubjects: subjectsOf(repo, sourceRange),
      testSubjects: testRange ? subjectsOf(repo, testRange) : [],
      exemptions,
      version,
    })

    const text = renderStatus(report, {
      version,
      strict: args.strict,
      testLineMissing: !testLineRef,
      noTestTrunk: Boolean(testLineRef && !testTrunk),
      sourceRange,
      testRange: testRange ?? undefined,
    })
    console.log(text)
    summary(text)

    if (args.strict && report.missing.length) {
      console.error(`::error::Còn ${report.missing.length} task thiếu test ở version ${version}.`)
      return 1
    }
    return 0
  } catch (e) {
    if (e instanceof ToolError) {
      console.error(e.message)
      return 2
    }
    console.error(e instanceof Error ? e.message : String(e))
    return 2
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
