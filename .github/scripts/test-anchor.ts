#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseJsonObject } from './lib/json.js'
import { versionOf } from './test-ref.js'

const ROOT = path.resolve(import.meta.dir, '..', '..')

/** Số commit tối đa liệt kê trong báo cáo. */
export const COMMIT_LIMIT = 20

export type AnchorVerdict = 'match' | 'behind' | 'ahead' | 'diverged' | 'other-version' | 'no-anchor' | 'anchor-gone'

export interface AnchorInput {
  /** `baseline.source_sha` — neo của dòng source. */
  anchorSha?: string
  /** `baseline.source_ref` — chỉ dùng để so version, không dùng để kết luận khớp. */
  anchorRef?: string
  /** `baseline.test_sha` — neo của dòng test; in ra để truy vết, không tham gia phân loại. */
  testAnchorSha?: string
  headSha: string
  headRef: string
  /** Object của `anchorSha` có tới được sau khi đã thử fetch hay không. */
  exists: boolean
  /** `git merge-base --is-ancestor <anchor> <head>`. */
  isAncestor: boolean
  /** `git merge-base --is-ancestor <head> <anchor>` — neo đi trước source. */
  isDescendant: boolean
}

/**
 * Phân loại neo thành một trong bảy kết luận. `!exists` phải xét trước mọi phép so
 * quan hệ tổ tiên, nếu không neo mất tích bị đọc thành `diverged`.
 */
export function classifyAnchor(i: AnchorInput): AnchorVerdict {
  if (!i.anchorSha) return 'no-anchor'
  if (!i.exists) return 'anchor-gone'
  if (i.anchorSha === i.headSha) return 'match'

  const anchorVersion = i.anchorRef ? versionOf(i.anchorRef) : null
  const headVersion = versionOf(i.headRef)
  if (anchorVersion && headVersion && anchorVersion !== headVersion) return 'other-version'

  if (i.isAncestor) return 'behind'
  if (i.isDescendant) return 'ahead'
  return 'diverged'
}

/** `anchor-gone` chặn ở mọi chế độ; `strict` chặn mọi kết luận khác `match`. */
export function isBlocking(v: AnchorVerdict, strict: boolean): boolean {
  if (v === 'anchor-gone') return true
  return strict && v !== 'match'
}

const HEADLINE: Record<AnchorVerdict, string> = {
  match: '## ✅ Cổng neo SHA — neo khớp head của PR',
  behind: '## ⚠️ Cổng neo SHA — test xanh nhưng viết cho ref neo CŨ',
  ahead: '## ⚠️ Cổng neo SHA — test chờ source',
  diverged: '## ⚠️ Cổng neo SHA — neo lệch nhánh',
  'other-version': '## ⚠️ Cổng neo SHA — neo thuộc version KHÁC',
  'no-anchor': '## ⚠️ Cổng neo SHA — chưa có neo để so',
  'anchor-gone': '## ❌ Cổng neo SHA — CHẶN: ref neo không tìm thấy',
}

const EXPLAIN: Record<AnchorVerdict, string[]> = {
  match: ['Baseline được đo đúng trên cây source đang phát hành. Tiêu chí lệch pha: **đạt**.'],
  behind: [
    'Lượt test cuối chạy trên một commit source **cũ hơn** head của PR này. Suite xanh nói',
    'về cây cũ đó, không nói gì về các commit thêm vào sau — nên đây **chưa** phải "đã test".',
    '',
    'Xử lý: push lại `dev/x.y.z/main` (hoặc chạy tay `Test overlay CI`) để dòng test chạy',
    'trên head hiện tại, rồi mở lại PR phát hành.',
  ],
  ahead: [
    'Neo đi **trước** head của PR: test đã chạy trên một commit source chưa có trong PR này.',
    'Đây là ca *"test chờ source"* — không phải lệch pha, thường do PR test merge trước.',
    '',
    'Xử lý: kiểm lại PR phát hành đã lấy đủ commit của dòng version chưa.',
  ],
  diverged: [
    'Neo tồn tại nhưng **không** có quan hệ tổ tiên với head (dòng source đã rebase, hoặc neo',
    'trỏ sang nhánh khác) ⇒ không đo được khoảng cách giữa hai cây.',
    '',
    'Xử lý: chạy lại CI dòng test để ghi neo mới trên đúng nhánh đang phát hành.',
  ],
  'other-version': [
    'Neo trong baseline thuộc **dòng version khác** với PR này ⇒ dòng test của version đang',
    'phát hành **chưa có lượt chạy nào**. Số coverage đang so là của version trước.',
    '',
    'Xử lý: mở dòng test `test/x.y.z/main` cho version này và để CI dòng test ghi neo mới.',
  ],
  'no-anchor': [
    'Baseline chưa có khoá `source_sha` — đây là baseline được ghi **trước** khi có cơ chế neo.',
    'Chưa có gì để so, nên cổng không chặn; nhưng 🚫 đây **không** phải "đạt".',
    '',
    'Neo được ghi **tự động** ở job `report` của `test-overlay.yml` (lượt push kế tiếp của dòng test).',
    'Muốn ghi tay thì phải có coverage của chính lượt đó trước, nếu không `--update` đỏ vì thiếu dữ liệu:',
    '',
    '```bash',
    'bun run test:fe && bun run test -- --coverage --coverage-reporter=lcov --coverage-dir=coverage/backend',
    'bun run coverage:gate -- --update \\',
    '  --source-sha "$(git rev-parse HEAD)" \\',
    '  --test-sha "$(git rev-parse origin/test/x.y.z/main)"',
    '```',
  ],
  'anchor-gone': [
    'SHA neo **không tới được** sau khi đã thử fetch theo SHA từ remote. Ba nguyên nhân cho',
    'cùng một kết quả, và cổng 🚫 **không** phân biệt được chúng từ đây:',
    '',
    '1. dòng source đã bị **force-push**, commit neo không còn trên remote;',
    '2. commit neo đã bị **bỏ** (branch xoá, history viết lại);',
    '3. workspace **không fetch được theo SHA** — clone nông, hoặc server không bật',
    '   `uploadpack.allowReachableSHA1InWant`.',
    '',
    'Cả ba dẫn tới cùng một chỗ: không có cây nào để đối chiếu ⇒ không kết luận được gì',
    'về lệch pha, nên cổng **chặn** thay vì bỏ qua.',
    '',
    'Kiểm nguyên nhân 3 trước: `fetch-depth: 0` ở step checkout, rồi `git cat-file -e <sha>^{commit}`.',
    'Nếu là 1 hoặc 2: chạy lại CI dòng test trên head hiện tại để ghi neo mới.',
  ],
}

function anchorTable(i: AnchorInput): string[] {
  const cell = (v: string | undefined) => (v ? `\`${v}\`` : '— **thiếu**')
  return [
    '| Vai trò | Ref | SHA |',
    '|---|---|---|',
    `| neo source (baseline) | ${cell(i.anchorRef)} | ${cell(i.anchorSha)} |`,
    `| neo test (baseline) | — | ${cell(i.testAnchorSha)} |`,
    `| head PR phát hành | ${cell(i.headRef)} | ${cell(i.headSha)} |`,
  ]
}

export function renderAnchor(v: AnchorVerdict, i: AnchorInput, commits: string[]): string {
  const lines = [HEADLINE[v], '', ...anchorTable(i), '', ...EXPLAIN[v]]

  if (i.anchorSha && !i.testAnchorSha) {
    lines.push('', '⚠️ Baseline có `source_sha` nhưng thiếu `test_sha` — không truy được cây test đã dùng.')
  }
  if (!i.anchorSha && i.testAnchorSha) {
    lines.push('', '⚠️ Baseline có `test_sha` nhưng thiếu `source_sha` — không so được với head của PR.')
  }

  if (commits.length) {
    lines.push('', `**${commits.length} commit source sau neo:**`, '', '```')
    lines.push(...commits.slice(0, COMMIT_LIMIT))
    if (commits.length > COMMIT_LIMIT) lines.push(`… và ${commits.length - COMMIT_LIMIT} commit nữa`)
    lines.push('```')
  }
  return lines.join('\n')
}

interface Args {
  baseline: string
  headSha?: string
  headRef?: string
  strict: boolean
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { baseline: 'reports/coverage-baseline.json', strict: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--strict') out.strict = true
    else if (a === '--baseline') out.baseline = argv[++i] ?? out.baseline
    else if (a === '--head-sha') out.headSha = argv[++i]
    else if (a === '--head-ref') out.headRef = argv[++i]
  }
  return out
}

interface GitResult {
  ok: boolean
  status: number | null
  out: string
}

function git(repo: string, ...args: string[]): GitResult {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? '').trim() }
}

export interface Anchor {
  source_sha?: string
  test_sha?: string
  source_ref?: string
}

const SHA_RE = /^[0-9a-f]{40}$/i

export function readAnchor(raw: string, file: string): Anchor {
  const b = parseJsonObject(raw, `Không đọc được neo: ${file}`)
  const str = (k: string) => (typeof b[k] === 'string' && b[k] ? (b[k] as string) : undefined)

  // xem docs/architecture/code/tooling.md §1
  const sha = (k: 'source_sha' | 'test_sha') => {
    const v = str(k)
    if (v && !SHA_RE.test(v)) {
      throw new Error(
        `Không đọc được neo: ${file} có ${k} = "${v}" không phải SHA đầy đủ (40 hex) — ` +
          'cổng neo so bằng chuỗi nên SHA viết tắt cho kết luận sai.',
      )
    }
    return v?.toLowerCase()
  }
  return { source_sha: sha('source_sha'), test_sha: sha('test_sha'), source_ref: str('source_ref') }
}

function summary(text: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY
  if (f) fs.appendFileSync(f, `${text}\n`)
}

// xem docs/architecture/code/tooling.md §1
function anchorExists(repo: string, sha: string): boolean {
  if (git(repo, 'cat-file', '-e', `${sha}^{commit}`).ok) return true
  git(repo, 'fetch', '--no-tags', '--quiet', 'origin', sha)
  return git(repo, 'cat-file', '-e', `${sha}^{commit}`).ok
}

class ToolError extends Error {}

function loadAnchor(repo: string, baseline: string): Anchor {
  const file = path.isAbsolute(baseline) ? baseline : path.join(repo, baseline)
  if (!fs.existsSync(file)) {
    throw new ToolError(
      `Không đọc được neo: không thấy baseline ${baseline}.\n` +
        'Thiếu baseline KHÔNG phải "đạt": không có file thì không có neo, mà "không kết luận được"\n' +
        'chưa bao giờ là "đạt". `release-test-gate.yml` chặn ca này ở bước "Fetch SHA anchor from test line".',
    )
  }
  return readAnchor(fs.readFileSync(file, 'utf8'), baseline)
}

function anchorReachable(repo: string, sha: string | undefined): boolean {
  if (!sha) return false
  if (anchorExists(repo, sha)) return true

  const probe = git(repo, 'ls-remote', '--exit-code', 'origin')
  if (probe.status !== 0 && probe.status !== 2) {
    throw new ToolError(
      `Không đọc được neo: không tới được remote để kiểm SHA neo ${sha}.\n` +
        'Đây KHÔNG phải "neo không còn tồn tại" và cũng KHÔNG phải "đạt" — sửa mạng/quyền (hoặc `fetch-depth: 0`) rồi chạy lại.',
    )
  }
  return false
}

export function main(argv: string[], repo: string = ROOT): number {
  const args = parseArgs(argv)
  const g = (...a: string[]) => git(repo, ...a)

  if (!g('rev-parse', '--git-dir').ok) {
    console.error(`Không đọc được neo: ${repo} không phải git repo — cổng neo cần lịch sử git để so.`)
    return 2
  }

  let anchor: Anchor
  let exists: boolean
  let headSha: string
  let headRef: string
  try {
    anchor = loadAnchor(repo, args.baseline)
    headSha = args.headSha?.trim() || g('rev-parse', 'HEAD').out
    headRef = args.headRef?.trim() || g('branch', '--show-current').out
    if (!headSha) {
      throw new ToolError('Không đọc được neo: không suy được head SHA. Truyền `--head-sha <sha>` (trên CI: head SHA của PR).')
    }
    exists = anchorReachable(repo, anchor.source_sha)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 2
  }

  const input: AnchorInput = {
    anchorSha: anchor.source_sha,
    anchorRef: anchor.source_ref,
    testAnchorSha: anchor.test_sha,
    headSha,
    headRef,
    exists,
    isAncestor: exists ? g('merge-base', '--is-ancestor', anchor.source_sha!, headSha).ok : false,
    isDescendant: exists ? g('merge-base', '--is-ancestor', headSha, anchor.source_sha!).ok : false,
  }

  const verdict = classifyAnchor(input)
  const commits =
    verdict === 'behind'
      ? g('log', '--oneline', '--no-merges', `${anchor.source_sha}..${headSha}`)
          .out.split('\n')
          .filter(Boolean)
      : []

  const text = renderAnchor(verdict, input, commits)
  console.log(text)
  summary(text)

  if (isBlocking(verdict, args.strict)) {
    console.error(`::error::Cổng neo SHA CHẶN — kết luận "${verdict}".`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
