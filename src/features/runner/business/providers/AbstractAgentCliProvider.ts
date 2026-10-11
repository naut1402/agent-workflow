import { appendTextFileSync, existsSync, joinPath } from '../../../../backend/lib/fileHelper.js'
import { spawn } from '../../../../backend/lib/processHelper.js'
import { resolveSecretRef } from '../credentials.js'
import { prepareSessionInvocation, type SessionCaptureMode, type SessionPrepareResult } from '../sessionLedger.js'
import type { CredentialProfile, ResolvedAgent } from '../types.js'
import { SecretMasker, SelfMcpServer } from '../../../mcp/business/index.js'
import { formatJobLogFooter, formatJobLogHeader } from '../jobLogFormat.js'
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

interface ProcResult {
  exitCode: number | null
  stdout: string
  stderr: string
  killed: boolean
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

function formatFailure(procResult: ProcResult, timeoutMs: number): string {
  if (procResult.killed) return `process timed out after ${timeoutMs}ms`
  const fromStreams = [procResult.stderr, procResult.stdout].filter(Boolean).join('\n').trim()
  if (fromStreams) return fromStreams.slice(0, 1000)
  return `exit code ${procResult.exitCode ?? 'unknown'}`
}

/** Payload header written to the job log before the process starts, so the raw
 * log (as shown in LogsPanel) explains what was actually sent to the runner
 * instead of just the interleaved stdout/stderr. */
function describePayload(opts: {
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
}): string {
  const cli = [opts.cliPath]
  let promptNote = ''
  if (opts.promptViaStdin) {
    // Argv already holds flags only; prompt is below under "--- Prompt ---".
    cli.push(...opts.argv)
    promptNote = '(prompt gửi qua stdin — xem "--- Prompt ---" bên dưới)'
  } else {
    // Keep the (potentially huge) prompt out of the CLI summary line.
    cli.push(...opts.flags, '<prompt — xem "--- Prompt ---" bên dưới>')
  }
  const agent = opts.resolvedAgent
  const agentLabel = agent.ref
    ? `${agent.ref}${agent.name ? ` (${agent.name})` : ''}`
    : `${agent.name || 'ad-hoc'} — không gắn agent, chạy prompt trực tiếp`
  const meta = opts.metadata || {}
  const lines = [
    formatJobLogHeader({
      jobId: String(meta.jobId || meta.logJobId || ''),
      providerId: typeof meta.providerId === 'string' ? meta.providerId : undefined,
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
      sessionId: opts.sessionId,
      resumeSessionId: opts.resumeSessionId,
      workspace: opts.workspace,
      mode: 'agent-cli',
    }).trimEnd(),
    '=== Payload gửi cho runner ===',
    `Agent: ${agentLabel}${agent.model ? ` — model: ${agent.model}` : ''}`,
    `Workspace: ${opts.workspace}`,
    `CLI: ${cli.join(' ')}`,
  ]
  if (promptNote) lines.push(promptNote)
  if (opts.metadata?.hasSelection) {
    const startLine = opts.metadata.selectionStartLine
    const endLine = opts.metadata.selectionEndLine
    const range = startLine != null ? ` — dòng ${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ''}` : ''
    lines.push(`Selection: ${opts.metadata.selectionChars ?? '?'} ký tự${range}`)
  }
  lines.push('--- Prompt ---', opts.prompt, '', '=== Phản hồi của runner (stdout/stderr) ===', '')
  return lines.join('\n')
}

/** Result footer appended after the process exits — the "what happened" summary
 * that used to be dropped once ExecuteResult was returned. */
function describeResult(result: ExecuteResult): string {
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

interface RunProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  onLog?: (chunk: string) => void
  onStart?: (info: { pid: number | null }) => void
  /** When set, written to the child's stdin (then stdin is closed) instead of
   * being passed as an argv element. Required for the claude headless prompt:
   * on Windows we must spawn with `shell: true` (to run the `claude.cmd` shim,
   * see CVE-2024-27980), but Node does NOT quote argv elements under
   * `shell: true` on Windows — it space-joins them for cmd.exe, so a
   * multi-line/whitespace prompt in argv gets split and `claude -p` only
   * receives the first token. Piping the prompt via stdin sidesteps quoting
   * entirely (`cat prompt | claude -p`). */
  stdinInput?: string
}

function runProcess(cliPath: string, args: string[], options: RunProcessOptions): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd: options.cwd,
      env: options.env,
      // win32: shell:true runs the .cmd shim; child.pid is cmd.exe — cancel must
      // use taskkill /T to kill the whole tree (see jobQueue cancelJob).
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    options.onStart?.({ pid: child.pid ?? null })

    if (options.stdinInput != null && child.stdin) {
      // Guard against EPIPE / write-after-end (e.g. the CLI exits before
      // draining stdin) so a broken pipe never leaves the Promise hanging or
      // crashes the process with an unhandled 'error'.
      child.stdin.on('error', () => {
        /* ignore broken pipe — close/error handlers below settle the Promise */
      })
      child.stdin.end(options.stdinInput)
    } else {
      child.stdin?.end()
    }

    let stdout = ''
    let stderr = ''
    const onLog = options.onLog

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      onLog?.(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      onLog?.(text)
    })

    let killed = false
    const timer =
      options.timeoutMs > 0
        ? setTimeout(() => {
            killed = true
            child.kill('SIGTERM')
          }, options.timeoutMs)
        : null

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ exitCode: killed ? -1 : code, stdout, stderr, killed })
    })
  })
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
    const appendLog = (text: string) => {
      if (!logPath) return
      try {
        appendTextFileSync(logPath, maskLog(text))
      } catch {
        /* ignore */
      }
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
        const result: ExecuteResult = {
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          logPath,
          error: `không sinh được file cấu hình MCP: ${String(err?.message ?? err)}`,
        }
        appendLog(describeResult(result))
        return result
      }

      const { args, stdinInput } = this.buildInvocation({ flags, prompt, runnerConfig, sessionPlan, mcpHandle })

      appendLog(
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

      // Chỉ id server + đường dẫn: nội dung file chứa env/header đã giải.
      // Warnings đã ra log qua `onWarning` ở trên, không lặp lại ở đây.
      if (mcpHandle) {
        appendLog(
          `[runner] MCP: ${mcpHandle.count} server (${mcpHandle.names.join(', ')}) → ${mcpHandle.path}\n`,
        )
        const notice = this.mcpNotice(mcpHandle)
        if (notice) appendLog(notice)
      }

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
        onLog?.(text)
        appendLog(text)
      }
      const wrappedOnLog = (chunk: string) => emitLog(streamMasker.push(chunk))
      // Gọi NGAY sau khi `runProcess` trả về / ném, TRƯỚC mọi `describeResult` —
      // nếu không thì dòng tổng kết chen lên trước phần đuôi của log stream.
      const flushStream = () => emitLog(streamMasker.flush())

      const wrappedOnStart = (info: { pid: number | null }) => {
        onStart?.(info)
        // So the UI delta stream is not stuck on an empty "=== Phản hồi ==="
        // section while the CLI is still thinking / using tools.
        appendLog(`[runner] process started pid=${info.pid ?? 'null'} — chờ stdout/stderr…\n`)
      }

      const timeoutMs = req.timeoutMs || runnerConfig.timeoutMs || 600_000
      let procResult: ProcResult
      try {
        procResult = await runProcess(cliPath, args, {
          cwd: req.workspace,
          env: buildChildEnv(credential, req.metadata),
          timeoutMs,
          onLog: wrappedOnLog,
          onStart: wrappedOnStart,
          stdinInput,
        })
      } catch (err: any) {
        flushStream()
        const result: ExecuteResult = {
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          logPath,
          error: maskLog(String(err.message || err)),
        }
        appendLog(describeResult(result))
        return result
      }
      flushStream()

      const artifactsFound: string[] = []
      if (req.produces?.length) {
        for (const name of req.produces) {
          const fp = joinPath(req.workspace, name)
          if (existsSync(fp)) artifactsFound.push(name)
        }
      }

      const ok = procResult.exitCode === 0 && !procResult.killed
      const output = this.parseOutput(procResult.stdout)
      const stdout = output.stdout
      const capturedSessionId: string | null | undefined =
        output.sessionId || (sessionPlan.presetSessionId ?? undefined)

      const result: ExecuteResult = {
        ok,
        exitCode: procResult.exitCode,
        durationMs: Date.now() - started,
        logPath,
        artifactsFound,
        // `formatFailure` dựng error từ stderr THÔ, mà error chảy vào
        // `jobs/<id>.json` (không 0600) và payload `job.failed` → events.jsonl
        // → SSE. `redactPayload` chỉ lọc theo tên khoá nên khoá `error` lọt sạch.
        error: ok ? undefined : maskLog(formatFailure(procResult, timeoutMs)),
        timedOut: procResult.killed,
        // stdout THÔ: là payload chức năng (proposal ghép vào scratch, dòng
        // ORCHESTRATOR_DECISION), mask mù sẽ cắt giữa artifact.
        stdout,
        // …còn bản ĐÃ MASK đi kèm cho biên persist/API (`JobRecord.stdout`,
        // `GET /api/jobs`). Hai đường tách hẳn nhau: đường chức năng đọc `stdout`,
        // đường ghi đĩa đọc `maskedStdout ?? stdout` (`jobQueue.persistStdout`).
        // 🚫 Không mask thẳng `stdout` — xem design §3.4.
        ...(mcpHandle?.masker.values.length ? { maskedStdout: maskLog(stdout) } : {}),
        sessionId: capturedSessionId,
        tokenUsage: output.tokenUsage,
      }
      appendLog(describeResult(result))
      return result
    } finally {
      mcpHandle?.dispose()
    }
  }
}
