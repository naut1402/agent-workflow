import {
  appendTextFileSync,
  dirname,
  existsSync,
  joinPath,
  mkdirSync,
  readTextFileSync,
  readdirSync,
  relativePath,
  resolvePathUnder,
  writeTextFileSync,
} from '../../../../core/lib/fileHelper.js'
import type { Dirent } from '../../../../core/lib/fileHelper.js'
import { spawnSync } from '../../../../core/lib/processHelper.js'
import { fetchUrlSafe } from '../../../agent-editor/business/index.js'
import { isDirectSecretType, resolveSecretRef } from '../credentials.js'
import { formatJobLogFooter, formatJobLogHeader } from '../jobLogFormat.js'
import { ensureFreshOAuthToken } from '../oauthCredentials.js'
import { mintSessionId } from '../sessionLedger.js'
import { appendTranscriptTurn, loadSessionMessages, saveSessionMessages } from './agentTranscriptStore.js'
import { shouldSendAgentInstructions } from './claude-code-cli.js'
import type { CredentialProfile, ExecuteRequest, ExecuteResult, ProviderFamily, RunnerProvider } from '../types.js'

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

/** Sent once when a turn comes back empty with no tool call — gives the model one chance to self-correct before the loop fails the job. */
export const EMPTY_REPLY_NUDGE_TEXT =
  'Bạn vừa trả lời trống và không gọi tool nào. Nếu đã hoàn tất nhiệm vụ, hãy trả lời ' +
  'bằng một câu văn bản ngắn xác nhận. Nếu chưa, hãy gọi đúng 1 trong các tool đã được ' +
  'liệt kê ở đầu system prompt.'

/** Marker line reprinted right before the model's response in the job log — now emitted by `onSystemPrompt` (see execute()) instead of unconditionally by describePayload(). */
export const RUNNER_RESPONSE_MARKER = '\n=== Phản hồi của runner ===\n\n'

/** Thrown when the turn after the nudge is still empty — surfaces as a clear `ok:false` instead of a silent `succeeded`. */
export const EMPTY_REPLY_ERROR_MESSAGE =
  'model trả lời rỗng và không gọi tool sau khi đã nhắc lại — có thể model không tương thích tốt với bộ tool hiện tại qua provider này'

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

function truncate(text: string | undefined | null, limit: number): string {
  const s = text ?? ''
  return s.length > limit ? `${s.slice(0, limit)}…` : s
}

/** Shared shape for `run_command`/git tools — `ok` mirrors the process exit code, distinct from `SandboxErr` (used only when the process itself couldn't run). */
interface ProcessResult {
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

/**
 * Thrown by `runConversation()` instead of a plain `Error` once `messages` has
 * accumulated any history worth keeping (system prompt, tool calls, partial
 * turns) — lets `execute()` persist that history via `saveSessionMessages()`
 * before surfacing the failure, so a resume after a mid-conversation error
 * doesn't start from an empty session.
 */
export class AgenticRunError extends Error {
  readonly partialMessages: unknown[]
  constructor(message: string, partialMessages: unknown[]) {
    super(message)
    this.name = 'AgenticRunError'
    this.partialMessages = partialMessages
  }
}

/** Result of one full turn of an API-based agentic conversation (tool-use loop included). */
export interface AgenticRunResult {
  finalText: string
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  /** Pre-summarized so the base class never needs to know a subclass's tool schema. */
  toolCalls: Array<{ name: string; argsSummary: string; ok: boolean; resultSummary: string }>
  /** Opaque to the base class — persisted verbatim, handed back to the same subclass on resume. */
  rawMessages: unknown[]
}

/** Same truncation rule as `summarize()`/`summarizeArgs()` (200 chars) — keeps a large tool outcome (e.g. `search_files` matches) from blowing up the job log. */
export function summarizeResult(outcome: unknown): string {
  try {
    const json = JSON.stringify(outcome)
    if (!json) return ''
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return ''
  }
}

/**
 * Lets `runConversation()` surface progress as it happens instead of the base
 * class only seeing the final `AgenticRunResult` once the whole tool-use loop
 * is done. A subclass that calls these opts out of the base class's legacy
 * "write everything from the returned result" fallback (see `execute()`) —
 * call them for every tool call / assistant turn, not just some.
 */
export interface AgenticStreamHandlers {
  /** A tool call just finished executing this turn — `ok`/`resultSummary` reflect the outcome, not just the call. */
  onToolCall: (call: { name: string; argsSummary: string; ok: boolean; resultSummary: string }) => void
  /**
   * Assistant text became available. `text` is a delta to append, not the
   * full turn so far — callers that don't have real token streaming just
   * call this once per turn with the whole turn text (`done` defaults to
   * `true`). A future streaming subclass calls it many times per turn with
   * `done: false`, then once more with the trailing delta (or `''`) and
   * `done: true` — the base class buffers deltas and only commits a
   * transcript turn (one JSONL line / chat bubble) at `done`, while still
   * tailing every delta into the raw job log immediately.
   */
  onAssistantChunk: (text: string, opts?: { done?: boolean }) => void
  /** Called exactly once by `runConversation()`, right after the system prompt is built — before the first model call. */
  onSystemPrompt: (system: string) => void
}

export interface AgenticRunContext {
  req: ExecuteRequest
  runnerConfig: Record<string, any>
  apiKey: string
  /** Loaded by the base class when `req.resumeSessionId` is set; [] for a fresh session. */
  priorMessages: unknown[]
  workspace: string
  /** Aborted on `cancelJob` — thread into fetch/SDK calls so cancelling stops the in-flight request. */
  signal?: AbortSignal
  /** Report tool calls / assistant text as they happen instead of only at the end — see `AgenticStreamHandlers`. */
  handlers: AgenticStreamHandlers
}

interface SandboxOk {
  ok: true
}
interface SandboxErr {
  ok: false
  error: string
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

/**
 * Common base for API-based agentic providers (openai/gemini/xai/anthropic —
 * "call the model over HTTP, let it read/write files via tools", as opposed to
 * spawning a CLI subprocess). Subclasses implement only `runConversation()`
 * (how to call the model + how tool schemas map to the 4 sandbox operations
 * below); everything else — credential/API-key resolution, session load/save,
 * transcript bookkeeping, path-sandboxed file ops, and the `RunnerProvider`
 * contract — is written once here.
 */
export abstract class AgenticApiProvider implements RunnerProvider {
  abstract readonly providerId: string
  readonly family: ProviderFamily = 'ai-api'

  /** The only method a subclass must implement — the model-specific tool-use loop. */
  protected abstract runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult>

  /**
   * Fetch the model ids this provider's endpoint currently serves, so
   * ConnectionDialog can offer them instead of a free-text guess. Optional —
   * override in a subclass whose SDK exposes a models-list endpoint; the
   * default rejects so callers get a clear reason instead of a silent [].
   */
  async listModels(_apiKey: string, _baseURL: string): Promise<string[]> {
    throw new Error('provider này không hỗ trợ liệt kê model')
  }

  // ---- Sandbox file-ops, shared by every subclass's tool implementations ----

  protected readWorkspaceFile(workspace: string, path: string): SandboxOk & { content: string } | SandboxErr {
    const p = resolvePathUnder(workspace, path)
    if (!p) return { ok: false, error: 'path outside workspace' }
    try {
      return { ok: true, content: readTextFileSync(p) }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  protected writeWorkspaceFile(workspace: string, path: string, content: string): SandboxOk | SandboxErr {
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

  protected editWorkspaceFile(workspace: string, path: string, oldStr: string, newStr: string): SandboxOk | SandboxErr {
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

  protected listWorkspaceDirectory(workspace: string, path?: string): (SandboxOk & { entries: string[] }) | SandboxErr {
    const p = resolvePathUnder(workspace, path ?? '.')
    if (!p) return { ok: false, error: 'path outside workspace' }
    try {
      return { ok: true, entries: readdirSync(p) }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  // ---- Opt-in extra tools (Connection.config.extraTools) — shared by every subclass ----

  /** Reads `runnerConfig.extraTools`, dropping anything not in `ExtraTool` — an unset/legacy connection resolves to `[]` (no behavior change). */
  protected resolveExtraTools(runnerConfig: Record<string, any>): ExtraTool[] {
    const raw = runnerConfig?.extraTools
    if (!Array.isArray(raw)) return []
    return raw.filter((v): v is ExtraTool => VALID_EXTRA_TOOLS.includes(v))
  }

  /** `web_search` only registers when this is true — an unconfigured key means the tool is absent, not present-and-always-failing. */
  protected isWebSearchConfigured(): boolean {
    return Boolean(process.env.BRAVE_SEARCH_API_KEY)
  }

  /**
   * Generated per-request from the tool names actually registered for this
   * turn — tells low-level models (via OpenRouter, unfamiliar with the tool
   * names baked into agent markdown written for the Claude Code CLI, e.g.
   * `find_symbol`/`Skill`/`Write`) exactly which tools exist here and to
   * ignore any others mentioned in the system prompt below it.
   */
  protected buildToolUsagePreamble(enabledTools: string[]): string {
    return [
      '## Tool khả dụng (DUY NHẤT — bỏ qua mọi tên tool khác được nhắc ở phần hướng dẫn bên dưới)',
      ...enabledTools.map((name) => `- ${TOOL_DESCRIPTIONS[name] ?? name}`),
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

  /** Chars kept per embedded file in `buildProjectContextPreamble()` — enough for AGENTS.md/project-rules.md,
   * bounded so a runaway file doesn't blow the context budget of small models. */
  private static readonly PROJECT_CONTEXT_FILE_LIMIT = 12_000

  /**
   * Agent markdown (designer.md, reviewer.md, ...) universally instructs the model to read
   * `AGENTS.md` (project root) and `.dev-team-agent/project-rules.md` — paths that sit *above*
   * `workspace` (the task folder). The sandbox tools here intentionally can't reach outside
   * `workspace` (see `resolvePathUnder` — a security invariant, not an oversight), and unlike the
   * CLI providers (real filesystem access, can walk up a directory when a literal path 404s) a
   * weak model just hits "path outside workspace" or silently skips the rule. Embedding both
   * files' content directly in the system prompt sidesteps the read entirely.
   */
  protected buildProjectContextPreamble(req: ExecuteRequest): string {
    const meta = req.metadata || {}
    const projectRoot = typeof meta.projectRoot === 'string' ? meta.projectRoot : undefined
    const devTeamRoot = typeof meta.devTeamRoot === 'string' ? meta.devTeamRoot : undefined
    const sections: string[] = []
    const tryEmbed = (dir: string | undefined, fileName: string) => {
      if (!dir) return
      try {
        const content = readTextFileSync(joinPath(dir, fileName))
        sections.push(`### ${fileName}\n\n${truncate(content, AgenticApiProvider.PROJECT_CONTEXT_FILE_LIMIT)}`)
      } catch {
        /* file doesn't exist for this project — nothing to embed */
      }
    }
    tryEmbed(projectRoot, 'AGENTS.md')
    tryEmbed(devTeamRoot, 'project-rules.md')
    if (!sections.length) return ''
    return [
      '## Nội dung file ngoài workspace (đã nhúng sẵn — KHÔNG gọi tool để đọc lại các file này)',
      'Hướng dẫn bên dưới có thể yêu cầu đọc `AGENTS.md` hoặc `.dev-team-agent/project-rules.md` — ' +
        '2 file này nằm ngoài workspace hiện tại nên không đọc được qua tool. Nội dung đã được nhúng ' +
        'sẵn dưới đây, dùng trực tiếp:',
      ...sections,
    ].join('\n\n')
  }

  /** `run_command` — allowlisted binary, argv-array (no `shell:true`), bounded timeout/output. */
  protected runShellCommand(workspace: string, command: string, args: string[]): ProcessResult | SandboxErr {
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
  protected gitStatus(workspace: string): ProcessResult | SandboxErr {
    return runGit(workspace, ['status', '--porcelain'])
  }

  protected gitDiff(workspace: string, path?: string, staged = false): ProcessResult | SandboxErr {
    const args = ['diff', ...(staged ? ['--staged'] : []), ...(path ? ['--', path] : [])]
    return runGit(workspace, args)
  }

  protected gitLog(workspace: string, limit = 20): ProcessResult | SandboxErr {
    const clamped = Math.min(Math.max(1, limit), 50)
    return runGit(workspace, ['log', `--max-count=${clamped}`, '--oneline'])
  }

  /** `search_files` — substring literal (not regex, avoids ReDoS from model-controlled input), capped result count. */
  protected searchFiles(
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
  protected async webSearch(
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
  protected async fetchUrl(url: string): Promise<(SandboxOk & { content: string }) | SandboxErr> {
    try {
      const text = await fetchUrlSafe(url)
      return { ok: true, content: truncate(text, 20_000) }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  // ---- RunnerProvider contract, shared by every subclass ----

  validateCredential(profile: CredentialProfile | undefined): { ok: boolean; errors: string[] } {
    const auth = resolveSecretRef(profile)
    if (isDirectSecretType(auth.type)) return { ok: true, errors: [] }
    return {
      ok: false,
      errors: ['secretRef phải là env:VAR_NAME, stored:<id> (dán secret qua UI), hoặc oauth:<id> (Connect via browser) cho provider API-based'],
    }
  }

  validateRunnerConfig(_config: Record<string, unknown> | undefined): { ok: boolean; errors: string[] } {
    // model/baseURL are optional — a connection with no model picked yet is valid
    // (the future model-rotation feature is expected to fill it in at execute time).
    return { ok: true, errors: [] }
  }

  capabilities(): { supportsAgentFile: boolean; supportsStreaming: boolean; maxConcurrency: number } {
    return { supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }
  }

  // ---- Job-log framing — mirrors the CLI providers' logPath convention so the
  // Logs panel is not empty just because this provider never spawns a subprocess. ----

  private describePayload(req: ExecuteRequest, runnerConfig: Record<string, any>, sessionId: string): string {
    const agent = req.resolvedAgent
    const agentLabel = agent.ref
      ? `${agent.ref}${agent.name ? ` (${agent.name})` : ''}`
      : `${agent.name || 'ad-hoc'} — không gắn agent, chạy prompt trực tiếp`
    const meta = req.metadata || {}
    const lines = [
      formatJobLogHeader({
        jobId: String(meta.jobId || req.jobId || ''),
        providerId: this.providerId,
        runnerId: typeof meta.runnerId === 'string' ? meta.runnerId : undefined,
        connectionId: typeof meta.connectionId === 'string' ? meta.connectionId : undefined,
        projectId: typeof meta.projectId === 'string' ? meta.projectId : undefined,
        taskId: typeof meta.taskId === 'string' ? meta.taskId : undefined,
        stepId:
          typeof meta.stepId === 'string'
            ? meta.stepId
            : typeof meta.pipelineStepId === 'string'
              ? meta.pipelineStepId
              : undefined,
        sessionId,
        resumeSessionId: req.resumeSessionId,
        workspace: req.workspace,
        mode: 'agentic-api',
      }).trimEnd(),
      '=== Payload gửi cho runner ===',
      `Agent: ${agentLabel}`,
      `Workspace: ${req.workspace}`,
      `Provider: ${this.providerId}${runnerConfig.model ? ` — model: ${runnerConfig.model}` : ''}`,
      '--- Prompt ---',
      req.userPrompt,
    ]
    return lines.join('\n')
  }

  private describeResult(result: ExecuteResult): string {
    return formatJobLogFooter({
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      sessionId: result.sessionId,
      error: result.error,
      artifactsFound: result.artifactsFound,
      tokenUsage: result.tokenUsage,
    })
  }

  // ---- Template method — fixed for every subclass, delegates to runConversation() ----

  async execute(req: ExecuteRequest, runnerConfig: Record<string, any>, credential: CredentialProfile): Promise<ExecuteResult> {
    const started = Date.now()
    const logPath = req.metadata?.logPath as string | undefined
    const appendLog = (text: string) => {
      if (!logPath) return
      try {
        appendTextFileSync(logPath, text)
      } catch {
        /* ignore */
      }
    }

    const sessionId = req.resumeSessionId ?? req.sessionId ?? mintSessionId()
    appendLog(this.describePayload(req, runnerConfig, sessionId))

    const auth = resolveSecretRef(credential)
    let apiKey: string
    if (auth.type === 'oauth') {
      const fresh = await ensureFreshOAuthToken(credential.secretRef.slice('oauth:'.length), this.providerId)
      if ('error' in fresh) {
        const result: ExecuteResult = { ok: false, exitCode: null, durationMs: Date.now() - started, logPath, sessionId, error: fresh.error }
        appendLog(this.describeResult(result))
        return result
      }
      apiKey = fresh.value
    } else if ((auth.type === 'env' || auth.type === 'stored') && auth.value) {
      apiKey = auth.value
    } else {
      let detail: string
      if (auth.type === 'env') detail = `biến môi trường "${auth.key}" chưa được đặt`
      else if (auth.type === 'stored') detail = process.env.DASHBOARD_SECRET_KEY
        ? 'secret trong vault không tìm thấy hoặc bị lỗi giải mã'
        : 'DASHBOARD_SECRET_KEY chưa được đặt — không thể đọc secret từ vault'
      else detail = `secretRef "${credential.secretRef}" không hỗ trợ cho API provider`
      const result: ExecuteResult = {
        ok: false,
        exitCode: null,
        durationMs: Date.now() - started,
        logPath,
        sessionId,
        error: `missing API key — ${detail}`,
      }
      appendLog(this.describeResult(result))
      return result
    }

    const priorMessages = req.resumeSessionId ? loadSessionMessages(req.resumeSessionId) : []

    if (req.userPrompt?.trim()) {
      appendTranscriptTurn(this.providerId, sessionId, { role: 'user', text: req.userPrompt })
    }

    // Streamed as `runConversation()` progresses (see `AgenticStreamHandlers`)
    // instead of only once at the very end. `streamed` tracks whether the
    // subclass actually used these — if it never calls them (e.g. the older,
    // non-streaming shape), `execute()` falls back to writing everything from
    // the returned `result` in one shot below, exactly as before.
    let streamed = false
    let assistantBuffer = ''
    const flushAssistantBuffer = (): void => {
      const full = assistantBuffer
      assistantBuffer = ''
      if (full.trim()) {
        appendTranscriptTurn(this.providerId, sessionId, { role: 'assistant', text: full })
        appendLog('\n')
      }
    }
    const handlers: AgenticStreamHandlers = {
      onSystemPrompt: (system) => {
        if (!shouldSendAgentInstructions(req)) {
          appendLog(`--- System prompt (không đổi — đã gửi ở job trước của phiên này) ---${RUNNER_RESPONSE_MARKER}`)
          return
        }
        appendLog(`--- System prompt (đã gửi cho model) ---\n${system}\n${RUNNER_RESPONSE_MARKER}`)
      },
      onToolCall: (call) => {
        streamed = true
        appendTranscriptTurn(this.providerId, sessionId, { role: 'tool', tool: call.name, text: call.argsSummary })
        const status = call.ok ? 'ok' : `FAIL: ${call.resultSummary}`
        appendLog(`[tool] ${call.name} ${call.argsSummary} → ${status}\n`)
      },
      onAssistantChunk: (text, opts) => {
        streamed = true
        if (text) appendLog(text)
        assistantBuffer += text
        if (opts?.done !== false) flushAssistantBuffer()
      },
    }

    let result: AgenticRunResult
    try {
      result = await this.runConversation({
        req,
        runnerConfig,
        apiKey,
        priorMessages,
        workspace: req.workspace,
        signal: req.signal,
        handlers,
      })
    } catch (err: any) {
      flushAssistantBuffer() // don't lose a partially-streamed turn if the loop threw mid-turn
      // `.length` guard: avoid overwriting an already-persisted session with `[]`
      // if some future throw site forgets to pass a full `messages` array.
      if (err instanceof AgenticRunError && Array.isArray(err.partialMessages) && err.partialMessages.length) {
        saveSessionMessages(sessionId, err.partialMessages)
      }
      const failure: ExecuteResult = {
        ok: false,
        exitCode: null,
        durationMs: Date.now() - started,
        logPath,
        sessionId,
        error: String(err?.message ?? err),
      }
      appendLog(this.describeResult(failure))
      return failure
    }

    if (!streamed) {
      for (const call of result.toolCalls) {
        appendTranscriptTurn(this.providerId, sessionId, { role: 'tool', tool: call.name, text: call.argsSummary })
        const status = call.ok ? 'ok' : `FAIL: ${call.resultSummary}`
        appendLog(`[tool] ${call.name} ${call.argsSummary} → ${status}\n`)
      }
      if (result.finalText?.trim()) {
        appendTranscriptTurn(this.providerId, sessionId, { role: 'assistant', text: result.finalText })
        appendLog(`${result.finalText}\n`)
      }
    }
    saveSessionMessages(sessionId, result.rawMessages)

    const artifactsFound = (req.produces ?? []).filter((name) => existsSync(joinPath(req.workspace, name)))

    const final: ExecuteResult = {
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      logPath,
      stdout: result.finalText,
      tokenUsage: result.usage,
      sessionId,
      artifactsFound,
    }
    appendLog(this.describeResult(final))
    return final
  }
}
