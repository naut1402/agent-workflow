// Công cụ sandbox mà mọi provider API agentic nối vào vòng tool-use của nó:
// file-ops trong workspace, shell allowlist, git chỉ đọc, tìm kiếm, web (Brave),
// fetch URL an toàn — cùng mô tả tool và preamble gửi model.
//
// Module §2.3 (một hiện thực, không phải abstraction): `AgenticApiProvider` giữ
// trình tự, các hiện thực SDK (`OpenAiCompatibleProvider`,
// `AnthropicCompatibleProvider`) ánh xạ schema tool của SDK vào các hàm dưới đây.

import {
  dirname,
  joinPath,
  mkdirSync,
  readTextFileSync,
  readdirSync,
  relativePath,
  resolvePathUnder,
  writeTextFileSync,
} from '../../../../backend/lib/fileHelper.js'
import type { Dirent } from '../../../../backend/lib/fileHelper.js'
import { spawnSync } from '../../../../backend/lib/processHelper.js'
import { fetchUrlSafe } from '../../../agent-editor/business/index.js'
import type { McpBridgeTool } from '../mcpDelivery/ToolBridgeMcpDelivery.js'
import type { ExecuteRequest } from './RunnerProvider.js'

/** Opt-in extra sandbox capabilities beyond the base 4 file-ops — gated per-Connection via `Connection.config.extraTools`. */
export type ExtraTool = 'shell' | 'git' | 'search' | 'web'
const VALID_EXTRA_TOOLS: ExtraTool[] = ['shell', 'git', 'search', 'web']

/**
 * Allowlisted binaries for `run_command` — no raw shell, argv-array only (no injection via `;`/`&&`/`$()`).
 * Chỉ những binary image bảo đảm có (`docker/Dockerfile`) — list này vào thẳng tool description,
 * tên không tồn tại là mời model gọi rồi nhận ENOENT. Bin project-local: gọi qua `npx <bin>`.
 */
export const SHELL_ALLOWLIST = ['bun', 'npm', 'npx', 'node']
const SHELL_TIMEOUT_MS = 60_000
const SHELL_OUTPUT_LIMIT = 8_000
const SEARCH_MAX_MATCHES = 200
const SEARCH_EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build'])
const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'

/** One-line description per tool name, shown to low-level models in the "tool usage preamble" (see `buildToolUsagePreamble`). */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_file: 'read_file(path) — đọc nội dung 1 file text trong workspace',
  write_file: 'write_file(path, content) — tạo mới/ghi đè 1 file text trong workspace',
  edit_file: 'edit_file(path, old_string, new_string) — thay 1 đoạn text duy nhất trong file',
  list_directory: 'list_directory(path?) — liệt kê entry của 1 thư mục trong workspace',
  str_replace_based_edit_tool:
    'str_replace_based_edit_tool(command, path, ...) — đọc/tạo/sửa file qua 1 tool duy nhất, command: ' +
    '"view" (đọc file), "create" (tạo/ghi đè, cần file_text), "str_replace" (thay old_str bằng new_str, cần duy nhất 1 chỗ khớp), ' +
    '"insert" (chèn new_str sau dòng insert_line)',
  run_command: `run_command(command, args[]) — chạy 1 lệnh shell trong workspace, chỉ cho phép: ${SHELL_ALLOWLIST.join(', ')}`,
  git_status: 'git_status() — trạng thái git (porcelain) của workspace',
  git_diff: 'git_diff(path?, staged?) — diff của workspace hoặc 1 file',
  git_log: 'git_log(limit?) — lịch sử commit gần nhất (oneline, tối đa 50)',
  search_files: 'search_files(pattern, path?) — tìm 1 chuỗi con (không phải regex) trong các file text của workspace',
  web_search: 'web_search(query) — tìm kiếm web (Brave Search), trả tối đa 5 kết quả',
  fetch_url: 'fetch_url(url) — tải nội dung 1 URL https công khai (chặn host nội bộ/private)',
}

/** Chars kept per embedded file in `buildProjectContextPreamble()` — enough for AGENTS.md/CLAUDE.md,
 * bounded so a runaway file doesn't blow the context budget of small models. */
const PROJECT_CONTEXT_FILE_LIMIT = 12_000

export function truncate(text: string | undefined | null, limit: number): string {
  const s = text ?? ''
  return s.length > limit ? `${s.slice(0, limit)}…` : s
}

export interface SandboxOk {
  ok: true
}
export interface SandboxErr {
  ok: false
  error: string
}

/** Shared shape for `run_command`/git tools — `ok` mirrors the process exit code, distinct from `SandboxErr` (used only when the process itself couldn't run). */
export interface ProcessResult {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
}

function runGit(workspace: string, args: string[]): ProcessResult | SandboxErr {
  const res = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS })
  if (res.error) return { ok: false, error: String(res.error.message) }
  return {
    ok: res.status === 0,
    exitCode: res.status,
    stdout: truncate(res.stdout, SHELL_OUTPUT_LIMIT),
    stderr: truncate(res.stderr, SHELL_OUTPUT_LIMIT),
  }
}

/** Depth-first collect of file paths under `root`, skipping `SEARCH_EXCLUDED_DIRS` — stops early once well past the match cap. */
function collectTextFiles(root: string, out: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= SEARCH_MAX_MATCHES * 4) return
    if (entry.isDirectory()) {
      if (SEARCH_EXCLUDED_DIRS.has(entry.name)) continue
      collectTextFiles(joinPath(root, entry.name), out)
    } else if (entry.isFile()) {
      out.push(joinPath(root, entry.name))
    }
  }
}

function isLikelyBinary(content: string): boolean {
  return content.includes('\u0000')
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let from = 0
  for (;;) {
    const idx = haystack.indexOf(needle, from)
    if (idx < 0) break
    count++
    from = idx + needle.length
  }
  return count
}

// ---- Sandbox file-ops ----

export function readWorkspaceFile(workspace: string, path: string): (SandboxOk & { content: string }) | SandboxErr {
  const p = resolvePathUnder(workspace, path)
  if (!p) return { ok: false, error: 'path outside workspace' }
  try {
    return { ok: true, content: readTextFileSync(p) }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

export function writeWorkspaceFile(workspace: string, path: string, content: string): SandboxOk | SandboxErr {
  const p = resolvePathUnder(workspace, path)
  if (!p) return { ok: false, error: 'path outside workspace' }
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeTextFileSync(p, content)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

export function editWorkspaceFile(workspace: string, path: string, oldStr: string, newStr: string): SandboxOk | SandboxErr {
  const p = resolvePathUnder(workspace, path)
  if (!p) return { ok: false, error: 'path outside workspace' }
  if (!oldStr) return { ok: false, error: 'old_string is required' }
  let base: string
  try {
    base = readTextFileSync(p)
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
  const occurrences = countOccurrences(base, oldStr)
  if (occurrences === 0) return { ok: false, error: 'old_string not found' }
  if (occurrences > 1) return { ok: false, error: 'old_string not unique' }
  try {
    writeTextFileSync(p, base.replace(oldStr, newStr))
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

export function listWorkspaceDirectory(workspace: string, path?: string): (SandboxOk & { entries: string[] }) | SandboxErr {
  const p = resolvePathUnder(workspace, path ?? '.')
  if (!p) return { ok: false, error: 'path outside workspace' }
  try {
    return { ok: true, entries: readdirSync(p) }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

// ---- Opt-in extra tools (Connection.config.extraTools) ----

/** Reads `runnerConfig.extraTools`, dropping anything not in `ExtraTool` — an unset/legacy connection resolves to `[]` (no behavior change). */
export function resolveExtraTools(runnerConfig: Record<string, any>): ExtraTool[] {
  const raw = runnerConfig?.extraTools
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is ExtraTool => VALID_EXTRA_TOOLS.includes(v))
}

/** `web_search` only registers when this is true — an unconfigured key means the tool is absent, not present-and-always-failing. */
export function isWebSearchConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY)
}

/**
 * Generated per-request from the tool names actually registered for this
 * turn — tells low-level models (via OpenRouter, unfamiliar with the tool
 * names baked into agent markdown written for the Claude Code CLI, e.g.
 * `find_symbol`/`Skill`/`Write`) exactly which tools exist here and to
 * ignore any others mentioned in the system prompt below it.
 */
export function buildToolUsagePreamble(enabledTools: string[], mcpTools: McpBridgeTool[] = []): string {
  return [
    '## Tool khả dụng (DUY NHẤT — bỏ qua mọi tên tool khác được nhắc ở phần hướng dẫn bên dưới)',
    ...enabledTools.map((name) => `- ${TOOL_DESCRIPTIONS[name] ?? name}`),
    // 📌 BẮT BUỘC khi bridge mở: dòng tiêu đề ngay trên nói với model rằng danh
    // sách này là DUY NHẤT. Thêm tool vào SDK mà không thêm vào đây thì model
    // được bảo là chúng không tồn tại, và nó sẽ không gọi.
    ...mcpTools.map((t) => `- ${t.name}: ${t.description}`),
    '',
    'Hướng dẫn bên dưới có thể nhắc tới các công cụ không tồn tại ở đây (vd find_symbol, ' +
      'Serena MCP, Skill, Write, Read, Edit, TaskCreate...) — đó là tài liệu viết cho môi trường ' +
      'khác, KHÔNG áp dụng. Chỉ gọi đúng tên tool trong danh sách trên.',
    '',
    'Quy ước path: workspace hiện tại CHÍNH LÀ thư mục task (nơi chứa request.md), không phải ' +
      'root repo. Mọi path truyền cho tool ở trên phải tương đối ngay trong workspace này — ví dụ ' +
      'dùng `qa.md`, `investigate.md`, KHÔNG dùng `.dev-team-agent/tasks/<task-id>/qa.md` hay bất kỳ ' +
      'tiền tố thư mục nào khác dù hướng dẫn bên dưới viết path đầy đủ như vậy (path đó viết cho môi ' +
      'trường có cwd ở root repo).',
  ].join('\n')
}

/**
 * Agent markdown (designer.md, reviewer.md, ...) universally instructs the model to read the
 * project's agent hub — `AGENTS.md` / `CLAUDE.md` at the project root — paths that sit *above*
 * `workspace` (the task folder). The sandbox tools here intentionally can't reach outside
 * `workspace` (see `resolvePathUnder` — a security invariant, not an oversight), and unlike the
 * CLI providers (real filesystem access, can walk up a directory when a literal path 404s) a
 * weak model just hits "path outside workspace" or silently skips the rule. Embedding those
 * files' content directly in the system prompt sidesteps the read entirely.
 */
export function buildProjectContextPreamble(req: ExecuteRequest): string {
  const meta = req.metadata || {}
  const projectRoot = typeof meta.projectRoot === 'string' ? meta.projectRoot : undefined
  const sections: string[] = []
  const tryEmbed = (dir: string | undefined, fileName: string) => {
    if (!dir) return
    try {
      const content = readTextFileSync(joinPath(dir, fileName))
      sections.push(`### ${fileName}\n\n${truncate(content, PROJECT_CONTEXT_FILE_LIMIT)}`)
    } catch {
      /* file doesn't exist for this project — nothing to embed */
    }
  }
  tryEmbed(projectRoot, 'AGENTS.md')
  tryEmbed(projectRoot, 'CLAUDE.md')
  if (!sections.length) return ''
  return [
    '## Nội dung file ngoài workspace (đã nhúng sẵn — KHÔNG gọi tool để đọc lại các file này)',
    'Hướng dẫn bên dưới có thể yêu cầu đọc `AGENTS.md` hoặc `CLAUDE.md` ở root repo — ' +
      'các file này nằm ngoài workspace hiện tại nên không đọc được qua tool. Nội dung đã được nhúng ' +
      'sẵn dưới đây, dùng trực tiếp:',
    ...sections,
  ].join('\n\n')
}

/** `run_command` — allowlisted binary, argv-array (no `shell:true`), bounded timeout/output. */
export function runShellCommand(workspace: string, command: string, args: string[]): ProcessResult | SandboxErr {
  if (!SHELL_ALLOWLIST.includes(command)) {
    return { ok: false, error: `lệnh "${command}" không nằm trong allowlist: ${SHELL_ALLOWLIST.join(', ')}` }
  }
  const res = spawnSync(command, args, { cwd: workspace, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS })
  if (res.error) return { ok: false, error: String(res.error.message) }
  if (res.signal === 'SIGTERM') return { ok: false, error: `lệnh quá thời gian cho phép (${SHELL_TIMEOUT_MS}ms)` }
  return {
    ok: res.status === 0,
    exitCode: res.status,
    stdout: truncate(res.stdout, SHELL_OUTPUT_LIMIT),
    stderr: truncate(res.stderr, SHELL_OUTPUT_LIMIT),
  }
}

/** Read-only git tools — no commit/push/branch (write ops are out of scope, see design.md §6). */
export function gitStatus(workspace: string): ProcessResult | SandboxErr {
  return runGit(workspace, ['status', '--porcelain'])
}

export function gitDiff(workspace: string, path?: string, staged = false): ProcessResult | SandboxErr {
  const args = ['diff', ...(staged ? ['--staged'] : []), ...(path ? ['--', path] : [])]
  return runGit(workspace, args)
}

export function gitLog(workspace: string, limit = 20): ProcessResult | SandboxErr {
  const clamped = Math.min(Math.max(1, limit), 50)
  return runGit(workspace, ['log', `--max-count=${clamped}`, '--oneline'])
}

/** `search_files` — substring literal (not regex, avoids ReDoS from model-controlled input), capped result count. */
export function searchFiles(
  workspace: string,
  pattern: string,
  path?: string,
): (SandboxOk & { matches: Array<{ file: string; line: number; text: string }>; truncated: boolean }) | SandboxErr {
  const root = resolvePathUnder(workspace, path ?? '.')
  if (!root) return { ok: false, error: 'path outside workspace' }
  if (!pattern) return { ok: false, error: 'pattern is required' }
  const files: string[] = []
  collectTextFiles(root, files)
  const matches: Array<{ file: string; line: number; text: string }> = []
  for (const file of files) {
    let content: string
    try {
      content = readTextFileSync(file)
    } catch {
      continue
    }
    if (isLikelyBinary(content)) continue
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) {
        matches.push({ file: relativePath(workspace, file), line: i + 1, text: truncate(lines[i], 200) })
        if (matches.length >= SEARCH_MAX_MATCHES) break
      }
    }
    if (matches.length >= SEARCH_MAX_MATCHES) break
  }
  return { ok: true, matches, truncated: matches.length >= SEARCH_MAX_MATCHES }
}

/** `web_search` — Brave Search API; only called when `isWebSearchConfigured()` gated the tool into the schema. */
export async function webSearch(
  query: string,
): Promise<(SandboxOk & { results: Array<{ title: string; url: string; snippet: string }> }) | SandboxErr> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) return { ok: false, error: 'BRAVE_SEARCH_API_KEY chưa được cấu hình trên server' }
  try {
    const text = await fetchUrlSafe(`${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=5`, {
      headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    })
    const data = JSON.parse(text)
    const results = (Array.isArray(data?.web?.results) ? data.web.results : []).slice(0, 5).map((r: any) => ({
      title: String(r?.title ?? ''),
      url: String(r?.url ?? ''),
      snippet: String(r?.description ?? ''),
    }))
    return { ok: true, results }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** `fetch_url` — https-only/private-host/size-limit guards come from `fetchUrlSafe` (SSRF invariant, see AGENTS.md §4). */
export async function fetchUrl(url: string): Promise<(SandboxOk & { content: string }) | SandboxErr> {
  try {
    const text = await fetchUrlSafe(url)
    return { ok: true, content: truncate(text, 20_000) }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}
