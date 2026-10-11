import { resolveSecretRef } from '../credentials.js'
import { prepareSessionInvocation, type SessionCaptureMode, type SessionPrepareResult } from '../sessionLedger.js'
import type { CredentialProfile, ResolvedAgent } from '../types.js'
import { SecretMasker, SelfMcpServer } from '../../../mcp/business/index.js'
import { formatJobLogHeader } from '../jobLogFormat.js'
import type { McpConfigHandle } from '../mcpDelivery/FileMcpDelivery.js'
import type { McpJobDelivery } from '../mcpDelivery/McpJobDelivery.js'
import { NoMcpDelivery } from '../mcpDelivery/NoMcpDelivery.js'
import {
  shouldSendAgentInstructions,
  type ExecuteRequest,
  type ExecuteResult,
  type McpDelivery,
  type ProviderCatalogInfo,
  type RunnerProvider,
  type TokenUsage,
  type TranscriptFormat,
} from './RunnerProvider.js'
import { formatProcessFailure, runCliProcess, type ProcResult } from './cliProcess.js'
import { agentLabelOf, collectProducedArtifacts, createJobLogAppender, describeExecuteResult, jobLogHeaderMeta } from './providerJobReport.js'

/**
 * Agent CLI family — Claude / Cursor / Codex (and future AI CLIs).
 * Distinct from `console-command` (argv-only, never default AI runner).
 */
export interface AgentCliCapabilities {
  supportsAgentFile: boolean
  supportsStreaming: boolean
  maxConcurrency: number
  /** How session ids are obtained (mirrors SessionCaptureMode). */
  sessionCapture: SessionCaptureMode
  /** Whether this provider can supply token usage in ExecuteResult. */
  supportsTokenUsage: boolean
  /** `kind` của `RunnerProvider.mcpDelivery` — cùng giá trị catalog trả cho UI. */
  mcpDelivery: McpDelivery
}

/** Agent CLI providers implement RunnerProvider plus family metadata. */
export interface AgentCliProvider extends RunnerProvider {
  family: 'agent-cli'
  agentCapabilities(): AgentCliCapabilities
}

export function isAgentCliProvider(provider: RunnerProvider | null | undefined): provider is AgentCliProvider {
  if (!provider) return false
  const candidate = provider as Partial<AgentCliProvider>
  return typeof candidate.agentCapabilities === 'function' && candidate.family === 'agent-cli'
}

/** cwd for a real CLI child process is the task workspace (`req.workspace`), not the repo
 * root the agent markdown was written for — without this, a model follows the literal
 * `.dev-team-agent/tasks/<task-id>/...` paths in its instructions and writes artifacts one
 * directory too deep (`<task-id>/<task-id>/investigate.md`). */
const PATH_CONVENTION_PREAMBLE =
  'Quy ước path: thư mục làm việc hiện tại (cwd) CHÍNH LÀ thư mục task (nơi chứa request.md), ' +
  'KHÔNG phải root repo. Mọi file cần đọc/ghi ở dưới phải dùng path tương đối ngay trong thư mục ' +
  'này — ví dụ dùng `qa.md`, `investigate.md`, KHÔNG dùng `.dev-team-agent/tasks/<task-id>/qa.md` ' +
  'hay bất kỳ tiền tố thư mục nào khác, dù hướng dẫn bên dưới có viết path đầy đủ như vậy (path đó ' +
  'viết cho môi trường có cwd ở root repo).'

function buildPrompt(resolvedAgent: ResolvedAgent, userPrompt: string): string {
  const system = resolvedAgent.systemPrompt?.trim()
  if (!system) return userPrompt
  return `## Agent instructions\n\n${PATH_CONVENTION_PREAMBLE}\n\n${system}\n\n## Task\n\n${userPrompt}`
}

/**
 * Cấp token + base URL cho job orchestrator qua env, không dùng `--mcp-config`
 * (xem design.md §1/§4.2): tiến trình `claude`/`cursor-agent`/`codex` con kế
 * thừa env này, và khi CHÍNH nó dùng tool Bash để chạy `curl`, subprocess đó
 * lại kế thừa env của nó — không cần plumbing gì thêm ngoài cơ chế kế thừa env
 * chuẩn của OS. Token không đi qua argv/prompt
 * text nên không có vấn đề Windows argv-quoting, và model không "nhìn thấy"
 * giá trị thật của token trong context/transcript (chỉ viết literal tên biến
 * trong lệnh `curl`, shell mới thay giá trị lúc thực thi).
 *
 * Tên biến và guard thuộc `SelfMcpServer` — cùng guard với entry MCP tự gắn
 * (`SelfMcpServer.forJob`), nên env và tool không thể lệch nhau.
 */
function buildChildEnv(credential: CredentialProfile, metadata?: Record<string, unknown>): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const auth = resolveSecretRef(credential)
  if (auth.type === 'env' && auth.key && auth.value) {
    env[auth.key] = auth.value
  }
  Object.assign(env, SelfMcpServer.childEnv(metadata))
  return env
}

const PROMPT_PLACEHOLDER = '<prompt — xem "--- Prompt ---" bên dưới>'
const PROMPT_VIA_STDIN_NOTE = '(prompt gửi qua stdin — xem "--- Prompt ---" bên dưới)'

interface PayloadDescription {
  resolvedAgent: ResolvedAgent
  workspace: string
  cliPath: string
  flags: string[]
  /** Final argv actually spawned (flags only when prompt goes via stdin). */
  argv: string[]
  /** Prompt piped on stdin (Claude + Cursor parse-json) — never shown in CLI line. */
  promptViaStdin: boolean
  sessionId?: string
  resumeSessionId?: string
  prompt: string
  metadata?: Record<string, unknown>
}

/** Dòng `CLI:` của payload — prompt (có thể rất dài) không bao giờ nằm trong dòng này. */
function describeCliLine(opts: PayloadDescription): string {
  // Argv already holds flags only when the prompt goes via stdin; it is below under "--- Prompt ---".
  const cli = opts.promptViaStdin
    ? [opts.cliPath, ...opts.argv]
    : [opts.cliPath, ...opts.flags, PROMPT_PLACEHOLDER]
  return `CLI: ${cli.join(' ')}`
}

/** Dòng `Selection:` khi job chạy trên vùng chọn của artifact, hoặc `null`. */
function describeSelection(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata?.hasSelection) return null
  const startLine = metadata.selectionStartLine
  const endLine = metadata.selectionEndLine
  const range = startLine != null ? ` — dòng ${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ''}` : ''
  return `Selection: ${metadata.selectionChars ?? '?'} ký tự${range}`
}

/** Payload header written to the job log before the process starts, so the raw
 * log (as shown in LogsPanel) explains what was actually sent to the runner
 * instead of just the interleaved stdout/stderr. */
function describePayload(opts: PayloadDescription): string {
  const agent = opts.resolvedAgent
  const meta = opts.metadata || {}
  const lines = [
    formatJobLogHeader({
      jobId: String(meta.jobId || meta.logJobId || ''),
      providerId: typeof meta.providerId === 'string' ? meta.providerId : undefined,
      ...jobLogHeaderMeta(meta),
      sessionId: opts.sessionId,
      resumeSessionId: opts.resumeSessionId,
      workspace: opts.workspace,
      mode: 'agent-cli',
    }).trimEnd(),
    '=== Payload gửi cho runner ===',
    `Agent: ${agentLabelOf(agent)}${agent.model ? ` — model: ${agent.model}` : ''}`,
    `Workspace: ${opts.workspace}`,
    describeCliLine(opts),
  ]
  if (opts.promptViaStdin) lines.push(PROMPT_VIA_STDIN_NOTE)
  const selection = describeSelection(opts.metadata)
  if (selection) lines.push(selection)
  lines.push('--- Prompt ---', opts.prompt, '', '=== Phản hồi của runner (stdout/stderr) ===', '')
  return lines.join('\n')
}

/** Log job của một lần chạy: ghi (đã mask) và đóng kết quả lỗi kèm footer. */
interface AgentCliJobLog {
  logPath: string | undefined
  append: (text: string) => void
  mask: (text: string) => string
  /** Dựng `ExecuteResult` lỗi (không exit code), ghi footer rồi trả về. */
  fail: (error: string) => ExecuteResult
}

/** Mọi thứ `execute` đã chuẩn bị, chuyển cho bước spawn. */
interface AgentCliRun {
  req: ExecuteRequest
  runnerConfig: Record<string, any>
  credential: CredentialProfile
  cliPath: string
  flags: string[]
  prompt: string
  sessionPlan: SessionPrepareResult
  mcpHandle: McpConfigHandle | null
  log: AgentCliJobLog
  started: number
  onLog?: (chunk: string) => void
  onStart?: (info: { pid: number | null }) => void
}

/** Đầu vào `buildInvocation` — mọi thứ template đã chuẩn bị trước khi spawn. */
export interface AgentCliInvocationContext {
  flags: string[]
  prompt: string
  runnerConfig: Record<string, any>
  sessionPlan: SessionPrepareResult
  /** `null` khi job không bật MCP server nào ⇒ argv phải giữ nguyên từng byte. */
  mcpHandle: McpConfigHandle | null
}

export interface AgentCliInvocation {
  args: string[]
  /** Có giá trị ⇒ prompt đi qua stdin, không nằm trong argv. */
  stdinInput?: string
}

/** Kết quả `parseOutput` — stdout cho caller cùng session/usage CLI tự báo. */
export interface AgentCliOutput {
  stdout: string
  sessionId?: string
  tokenUsage?: TokenUsage
}

export interface AgentCliProviderOptions {
  /** Lệnh spawn khi `runnerConfig.cliPath` trống. */
  defaultCliPath?: string
  /**
   * Cách provider nhận MCP của job — lắp ráp ở `providerRegistry.ts`. Thiếu ⇒
   * `NoMcpDelivery`: job không nhận MCP, argv không đổi.
   *
   * 📌 Delivery phải khớp cách provider dựng argv: `config-file-flag` chỉ có cờ
   * ở `ClaudeCliProvider`, `workspace-config-file` chỉ có `--approve-mcps` ở
   * `CursorCliProvider`. Provider dựng sẵn luôn khớp; tổ hợp khác (test) truyền tường minh.
   */
  mcpDelivery?: McpJobDelivery<McpConfigHandle>
  /** Ghi đè cách bắt session id (mặc định theo từng hiện thực). */
  sessionCapture?: SessionCaptureMode
}

/**
 * Template Method cho mọi Agent CLI: MCP → argv → spawn → parse output.
 *
 * Hiện thực chỉ quyết phần riêng của CLI đó: dựng argv (`buildInvocation`),
 * đọc stdout (`parseOutput`), ghi chú tác dụng phụ MCP (`mcpNotice`). Trình tự,
 * log job, mask secret, env token điều phối và dọn file MCP viết một lần ở đây.
 */
export abstract class AbstractAgentCliProvider implements AgentCliProvider {
  abstract readonly providerId: string
  abstract readonly catalog: ProviderCatalogInfo
  readonly family = 'agent-cli' as const
  readonly acceptsAgent = true
  readonly transcriptFormat?: TranscriptFormat
  readonly mcpDelivery: McpJobDelivery<McpConfigHandle>
  protected readonly defaultCliPath: string
  protected readonly sessionCapture: SessionCaptureMode
  /** Provider đọc được file agent — chỉ Claude. */
  protected readonly supportsAgentFile: boolean = false

  constructor(defaults: { defaultCliPath: string; sessionCapture: SessionCaptureMode }, opts: AgentCliProviderOptions = {}) {
    this.defaultCliPath = opts.defaultCliPath ?? defaults.defaultCliPath
    this.sessionCapture = opts.sessionCapture ?? defaults.sessionCapture
    this.mcpDelivery = opts.mcpDelivery ?? new NoMcpDelivery()
  }

  /** argv (và stdin) riêng của CLI này. */
  protected abstract buildInvocation(ctx: AgentCliInvocationContext): AgentCliInvocation

  /** Đọc stdout thô — mặc định trả nguyên văn, không session / usage. */
  protected parseOutput(stdout: string): AgentCliOutput {
    return { stdout }
  }

  /** Dòng log mô tả tác dụng phụ của cách giao MCP (đã có `\n`), hoặc `null`. */
  protected mcpNotice(_handle: McpConfigHandle): string | null {
    return null
  }

  /**
   * --bare only supports ANTHROPIC_API_KEY; cli-session needs OAuth/keychain.
   * Luật có sẵn áp cho MỌI Agent CLI — giữ nguyên hành vi trước khi tách lớp.
   */
  protected effectiveFlags(flags: unknown, credential: CredentialProfile): string[] {
    const list = Array.isArray(flags) ? [...flags] : []
    const auth = resolveSecretRef(credential)
    if (auth.type === 'cli-session') {
      return list.filter((f) => f !== '--bare')
    }
    return list
  }

  validateRunnerConfig(config: Record<string, unknown> | undefined): { ok: boolean; errors: string[] } {
    const errors: string[] = []
    if (!config?.cliPath) errors.push('cliPath is required')
    return { ok: errors.length === 0, errors }
  }

  validateCredential(profile: CredentialProfile | undefined): { ok: boolean; errors: string[] } {
    if (!profile?.secretRef) return { ok: false, errors: ['secretRef required'] }
    return { ok: true, errors: [] }
  }

  capabilities(): { supportsAgentFile: boolean; supportsStreaming: boolean; maxConcurrency: number } {
    return {
      supportsAgentFile: this.supportsAgentFile,
      supportsStreaming: false,
      maxConcurrency: 1,
    }
  }

  agentCapabilities(): AgentCliCapabilities {
    return {
      supportsAgentFile: this.supportsAgentFile,
      supportsStreaming: false,
      maxConcurrency: 1,
      sessionCapture: this.sessionCapture,
      supportsTokenUsage: false,
      mcpDelivery: this.mcpDelivery.kind,
    }
  }

  async execute(
    req: ExecuteRequest,
    runnerConfig: Record<string, any>,
    credential: CredentialProfile,
    onLog?: (chunk: string) => void,
    onStart?: (info: { pid: number | null }) => void,
  ): Promise<ExecuteResult> {
    const started = Date.now()
    const cliPath = String(runnerConfig.cliPath || this.defaultCliPath)
    const flags = this.effectiveFlags(runnerConfig.flags, credential)
    const prompt = shouldSendAgentInstructions(req)
      ? buildPrompt(req.resolvedAgent, req.userPrompt)
      : req.userPrompt

    const sessionPlan = prepareSessionInvocation({
      capture: this.sessionCapture,
      sessionId: req.sessionId,
      resumeSessionId: req.resumeSessionId,
    })

    const logPath = req.metadata?.logPath as string | undefined
    let mcpHandle: McpConfigHandle | null = null
    // Đọc `mcpHandle` lúc gọi chứ không lúc khai: handle chỉ có sau khi serialize
    // xong, mà mọi dòng log đều phải đi qua cùng một bộ lọc.
    const maskLog = (text: string) =>
      mcpHandle?.masker.values.length ? mcpHandle.masker.mask(text) : text
    const appendLog = createJobLogAppender(logPath, maskLog)
    const log: AgentCliJobLog = {
      logPath,
      append: appendLog,
      mask: maskLog,
      fail: (error) => {
        const result: ExecuteResult = { ok: false, exitCode: null, durationMs: Date.now() - started, logPath, error }
        appendLog(describeExecuteResult(result))
        return result
      },
    }

    // try/finally phải ôm TOÀN BỘ phần còn lại, kể cả lời gọi sinh file và nhánh
    // trả ExecuteResult sớm khi runProcess ném — nếu không, file 0600 chứa secret
    // ở lại trên đĩa.
    try {
      try {
        // Một lời gọi cho mọi cách giao: delivery gắn theo provider (providerRegistry.ts)
        // nên provider không nhận MCP có `NoMcpDelivery` ⇒ `null`, argv không đổi.
        mcpHandle = await this.mcpDelivery.prepare({
          ids: runnerConfig.mcpServers,
          workspace: req.workspace,
          jobId: req.jobId,
          // Delivery claude đọc để tự gắn entry dev-team-dashboard cho job điều phối.
          metadata: req.metadata,
          // Nhận ngay lúc phát sinh, vì id bị tắt/xoá hết thì hàm trả `null`
          // và không còn handle nào mang warnings ra.
          onWarning: (message) => appendLog(`[runner] MCP warning: ${message}\n`),
          onLog: appendLog,
        })
      } catch (err: any) {
        // Chạy tiếp mà thiếu tool là kiểu hỏng tệ nhất: job fail vì lý do
        // không liên quan và không ai truy được về đây.
        return log.fail(`không sinh được file cấu hình MCP: ${String(err?.message ?? err)}`)
      }

      return await this.runInvocation({
        req,
        runnerConfig,
        credential,
        cliPath,
        flags,
        prompt,
        sessionPlan,
        mcpHandle,
        log,
        started,
        onLog,
        onStart,
      })
    } finally {
      mcpHandle?.dispose()
    }
  }

  /** Dòng log MCP — chỉ id server + đường dẫn: nội dung file chứa env/header đã giải. */
  private logMcpHandle(mcpHandle: McpConfigHandle | null, appendLog: (text: string) => void): void {
    // Warnings đã ra log qua `onWarning` của `prepare`, không lặp lại ở đây.
    if (!mcpHandle) return
    appendLog(`[runner] MCP: ${mcpHandle.count} server (${mcpHandle.names.join(', ')}) → ${mcpHandle.path}\n`)
    const notice = this.mcpNotice(mcpHandle)
    if (notice) appendLog(notice)
  }

  /** argv → log payload → spawn → kết quả. Chạy trong try/finally dọn MCP của `execute`. */
  private async runInvocation(run: AgentCliRun): Promise<ExecuteResult> {
    const { req, runnerConfig, cliPath, flags, prompt, sessionPlan, mcpHandle, log } = run
    const { args, stdinInput } = this.buildInvocation({ flags, prompt, runnerConfig, sessionPlan, mcpHandle })

    log.append(
      describePayload({
        resolvedAgent: req.resolvedAgent,
        workspace: req.workspace,
        cliPath,
        flags,
        argv: args,
        promptViaStdin: stdinInput != null,
        sessionId: sessionPlan.sessionId,
        resumeSessionId: sessionPlan.resumeSessionId,
        prompt,
        metadata: req.metadata,
      }),
    )
    this.logMcpHandle(mcpHandle, log.append)

    // MCP server (hoặc chính CLI) in token ra stderr là chuyện thường —
    // `401 Unauthorized: Bearer sk-…`. File config được bảo vệ 0600 mà log job
    // thì không, nên lọc ở đúng một chỗ trước khi chunk đi bất cứ đâu.
    //
    // Bộ lọc phải CÓ TRẠNG THÁI: `maskLog` là split/join từng chunk, nên một
    // secret bị tiến trình con xuất làm hai chunk lọt qua cả hai lần gọi.
    // Đổi lại, log trễ `max(len(secret)) - 1` ký tự ⇒ `flushStream()` là bắt
    // buộc ở CẢ nhánh thành công lẫn nhánh lỗi, nếu không là nuốt đuôi log.
    const streamMasker = (mcpHandle?.masker ?? SecretMasker.NONE).stream()
    const emitLog = (text: string) => {
      if (!text) return
      run.onLog?.(text)
      log.append(text)
    }
    const wrappedOnLog = (chunk: string) => emitLog(streamMasker.push(chunk))
    // Gọi NGAY sau khi `runCliProcess` trả về / ném, TRƯỚC mọi footer kết quả —
    // nếu không thì dòng tổng kết chen lên trước phần đuôi của log stream.
    const flushStream = () => emitLog(streamMasker.flush())

    const wrappedOnStart = (info: { pid: number | null }) => {
      run.onStart?.(info)
      // So the UI delta stream is not stuck on an empty "=== Phản hồi ==="
      // section while the CLI is still thinking / using tools.
      log.append(`[runner] process started pid=${info.pid ?? 'null'} — chờ stdout/stderr…\n`)
    }

    const timeoutMs = req.timeoutMs || runnerConfig.timeoutMs || 600_000
    let procResult: ProcResult
    try {
      procResult = await runCliProcess(cliPath, args, {
        cwd: req.workspace,
        env: buildChildEnv(run.credential, req.metadata),
        timeoutMs,
        stdin: 'pipe',
        onLog: wrappedOnLog,
        onStart: wrappedOnStart,
        stdinInput,
      })
    } catch (err: any) {
      flushStream()
      return log.fail(log.mask(String(err.message || err)))
    }
    flushStream()

    const result = this.buildResult(run, procResult, timeoutMs)
    log.append(describeExecuteResult(result))
    return result
  }

  /** `ExecuteResult` của lần chạy đã kết thúc (thành công hay exit code ≠ 0). */
  private buildResult(run: AgentCliRun, procResult: ProcResult, timeoutMs: number): ExecuteResult {
    const { req, sessionPlan, mcpHandle, log } = run
    const artifactsFound = collectProducedArtifacts(req.workspace, req.produces)

    const ok = procResult.exitCode === 0 && !procResult.killed
    const output = this.parseOutput(procResult.stdout)
    const stdout = output.stdout
    const capturedSessionId: string | null | undefined =
      output.sessionId || (sessionPlan.presetSessionId ?? undefined)

    return {
      ok,
      exitCode: procResult.exitCode,
      durationMs: Date.now() - run.started,
      logPath: log.logPath,
      artifactsFound,
      // `formatProcessFailure` dựng error từ stderr THÔ, mà error chảy vào
      // `jobs/<id>.json` (không 0600) và payload `job.failed` → events.jsonl
      // → SSE. `redactPayload` chỉ lọc theo tên khoá nên khoá `error` lọt sạch.
      error: ok ? undefined : log.mask(formatProcessFailure(procResult, timeoutMs)),
      timedOut: procResult.killed,
      // stdout THÔ: là payload chức năng (proposal ghép vào scratch, dòng
      // ORCHESTRATOR_DECISION), mask mù sẽ cắt giữa artifact.
      stdout,
      // …còn bản ĐÃ MASK đi kèm cho biên persist/API (`JobRecord.stdout`,
      // `GET /api/jobs`). Hai đường tách hẳn nhau: đường chức năng đọc `stdout`,
      // đường ghi đĩa đọc `maskedStdout ?? stdout` (`jobQueue.persistStdout`).
      // 🚫 Không mask thẳng `stdout` — xem design §3.4.
      ...(mcpHandle?.masker.values.length ? { maskedStdout: log.mask(stdout) } : {}),
      sessionId: capturedSessionId,
      tokenUsage: output.tokenUsage,
    }
  }
}
