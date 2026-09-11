#!/usr/bin/env bun
/**
 * Cổng **neo SHA** — trả lời đúng một câu: *số coverage và lượt test xanh trong
 * baseline được đo trên commit source nào, và commit đó có phải cái đang phát
 * hành không?*
 *
 * Vì sao cần: `coverage-baseline.json` trước đây chỉ lưu **tên branch**
 * (`source_ref: "dev/1.1.3/main"`), mà tên branch thì di chuyển. "Test xanh"
 * đọc từ đó không nói được nó xanh trên cây nào ⇒ PR phát hành có thể merge một
 * cây source chưa lượt test nào chạy qua, mà không cổng nào thấy.
 *
 * Bảy kết luận, mỗi cái một nguyên nhân và một cách xử lý khác nhau:
 *
 *   match          neo == head PR                       → ✅ exit 0
 *   behind         neo là tổ tiên của head              → ⚠️ test viết cho ref cũ
 *   ahead          head là tổ tiên của neo              → ⚠️ test chờ source
 *   diverged       neo tồn tại, không có quan hệ tổ tiên → ⚠️ không so được khoảng cách
 *   other-version  neo thuộc dòng version khác          → ⚠️ version này chưa có lượt test nào
 *   no-anchor      baseline chưa có khoá neo            → ⚠️ chưa so được
 *   anchor-gone    SHA neo không còn tồn tại            → ❌ exit 1
 *
 * Bất biến: 🚫 **không nhánh nào in "đạt"** ngoài `match`. "Không so được" là
 * cảnh báo hoặc chặn, không bao giờ là kết luận đạt — đó đúng là cái lỗ mà
 * force-push (`TC-E9`) chui qua.
 *
 * Mặc định chỉ `anchor-gone` chặn; `--strict` làm **mọi** kết luận khác `match`
 * chặn. Siết cổng về sau = thêm một cờ ở workflow, không sửa lại script.
 *
 *   bun run test:anchor -- --baseline reports/coverage-baseline.json
 *   bun run test:anchor -- --head-sha "$(git rev-parse HEAD)" --head-ref dev/1.1.4/main --strict
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseJsonObject } from './lib/json.js'
import { versionOf } from './test-ref.js'

const ROOT = path.resolve(import.meta.dir, '..', '..')

/** Danh sách commit trong cảnh báo là để người đọc *nhận ra* khoảng chênh, không phải để đọc hết. */
export const COMMIT_LIMIT = 20

export type AnchorVerdict = 'match' | 'behind' | 'ahead' | 'diverged' | 'other-version' | 'no-anchor' | 'anchor-gone'

export interface AnchorInput {
  /** `baseline.source_sha` — neo của dòng source. */
  anchorSha?: string
  /** `baseline.source_ref` — chỉ dùng để so **version**, không dùng để kết luận khớp. */
  anchorRef?: string
  /** `baseline.test_sha` — neo của dòng test; in ra để truy vết, không tham gia phân loại. */
  testAnchorSha?: string
  headSha: string
  headRef: string
  /** Object của `anchorSha` có tới được **sau khi đã thử fetch** hay không. */
  exists: boolean
  /** `git merge-base --is-ancestor <anchor> <head>`. */
  isAncestor: boolean
  /** `git merge-base --is-ancestor <head> <anchor>` — neo đi trước source. */
  isDescendant: boolean
}

/**
 * Thứ tự nhánh là phần **quan trọng nhất** của hàm này: nhánh sau không được
 * che nhánh trước. Cụ thể `!exists` phải nằm trên mọi phép so quan hệ tổ tiên —
 * `merge-base` với object không tồn tại trả về "false", tức là trông giống
 * `diverged` (cảnh báo, exit 0) trong khi thực tế là `anchor-gone` (chặn).
 */
export function classifyAnchor(i: AnchorInput): AnchorVerdict {
  if (!i.anchorSha) return 'no-anchor'
  if (!i.exists) return 'anchor-gone'
  if (i.anchorSha === i.headSha) return 'match'

  // Version suy được ở cả hai phía mà lệch nhau ⇒ nói thẳng "dòng test chưa
  // chạy cho version này", đừng bắt người đọc tự luận ra từ hai SHA lạ.
  const anchorVersion = i.anchorRef ? versionOf(i.anchorRef) : null
  const headVersion = versionOf(i.headRef)
  if (anchorVersion && headVersion && anchorVersion !== headVersion) return 'other-version'

  if (i.isAncestor) return 'behind'
  if (i.isDescendant) return 'ahead'
  return 'diverged'
}

/**
 * `anchor-gone` chặn ở mọi chế độ: không biết neo ở đâu thì không kết luận được
 * gì, và "không kết luận được" ở cổng chặn merge cuối cùng phải là đỏ.
 * `--strict` (siết về sau) chặn mọi thứ khác `match`.
 */
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

/** Bảng "cổng đã so cái gì" — người đọc phải kiểm chứng lại được kết luận, không chỉ thấy chữ OK. */
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

  // E18: nửa neo cũng phải nói ra — phần có vẫn so, phần thiếu vẫn cảnh báo.
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

/**
 * `repo` là tham số chứ không phải `ROOT` cố định: cổng này chỉ đúng/sai theo
 * **contract của git thật** (object còn hay mất, quan hệ tổ tiên), nên test phải
 * dựng được repo + origin tạm để chạy, không mock lại git theo giả định.
 */
function git(repo: string, ...args: string[]): GitResult {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? '').trim() }
}

export interface Anchor {
  source_sha?: string
  test_sha?: string
  source_ref?: string
}

/**
 * Đọc `source_sha` / `test_sha` mà **không** validate phần số của baseline —
 * phần số là **mốc tham chiếu**, không phải cổng (`testing.md` §6), nên số hỏng
 * 🚫 không được làm hỏng kết luận về neo. Nhưng file không parse được thì phải là
 * lỗi công cụ (exit 2), không được suy thành `no-anchor`.
 */
const SHA_RE = /^[0-9a-f]{40}$/i

export function readAnchor(raw: string, file: string): Anchor {
  const b = parseJsonObject(raw, `Không đọc được neo: ${file}`)
  const str = (k: string) => (typeof b[k] === 'string' && b[k] ? (b[k] as string) : undefined)

  /**
   * Đường **đọc** phải cùng ràng buộc với đường **ghi** (`normalizeSha` ở
   * `coverage-gate.ts`). Baseline là file người sửa được, nên SHA viết tắt vào
   * được file qua đường khác. Khi đó `cat-file -e` **thành công**
   * (git resolve viết tắt) và `merge-base` cũng đúng ⇒ `exists: true`, nhưng phép so
   * `anchorSha === headSha` là so chuỗi nên luôn false ⇒ verdict `behind` kèm
   * "0 commit source sau neo": cảnh báo sai chỗ, không ai truy ra được vì sao.
   *
   * 🚫 Không suy thành `no-anchor` — đó là "baseline cũ chưa có cơ chế neo", khác hẳn
   * "neo có nhưng không dùng được". Đây là lỗi công cụ ⇒ exit 2.
   */
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

/**
 * Object có tới được không — **sau khi** đã thử fetch một lượt.
 *
 * `actions/checkout` chỉ lấy đủ history của head ref, nên neo nằm ở dòng version
 * trước (vd `dev/1.1.3/main`) thì `cat-file` fail dù commit vẫn còn trên remote.
 * Kết luận `anchor-gone` mà không thử fetch là báo động giả ở **mọi** release
 * đầu version.
 */
function anchorExists(repo: string, sha: string): boolean {
  if (git(repo, 'cat-file', '-e', `${sha}^{commit}`).ok) return true
  git(repo, 'fetch', '--no-tags', '--quiet', 'origin', sha)
  return git(repo, 'cat-file', '-e', `${sha}^{commit}`).ok
}

/** Lỗi "cổng không đọc được dữ liệu" ⇒ exit 2, tách hẳn khỏi "cổng kết luận đỏ" (exit 1). */
class ToolError extends Error {}

/** Baseline có mặt và đọc được neo ra — thiếu file là exit 2, 🚫 không phải "đạt". */
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

/**
 * Neo mất tích *và* remote không tới được là hai chuyện khác nhau: một cái là kết
 * luận của cổng (exit 1), một cái là công cụ không đọc được dữ liệu (exit 2).
 * Kết luận `anchor-gone` phải theo cái **remote** thấy được, không theo cái
 * workspace này tình cờ còn — nên chỉ kết luận khi đã hỏi được remote.
 * `ls-remote --exit-code` thoát 2 = remote tới được nhưng KHÔNG có ref nào
 * (remote rỗng ⇒ neo thật sự không còn), khác hẳn lỗi mạng/quyền.
 */
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
