import { appendTextFileSync, existsSync, joinPath } from '../../../../core/lib/fileHelper.js'
import { spawn } from '../../../../core/lib/processHelper.js'
import { resolveSecretRef } from '../credentials.js'
import {
  buildCursorJsonInvocation,
  parseCursorJsonOutput,
  prepareSessionInvocation,
  type SessionCaptureMode,
} from '../sessionLedger.js'
import type { CredentialProfile, ExecuteRequest, ExecuteResult, ResolvedAgent, RunnerProvider } from '../types.js'
import type { AgentCliProvider } from './agentCli.js'
import { formatJobLogFooter, formatJobLogHeader } from '../jobLogFormat.js'

interface ProcResult {
  exitCode: number | null
  stdout: string
  stderr: string
  killed: boolean
}

function buildPrompt(resolvedAgent: ResolvedAgent, userPrompt: string): string {
  const system = resolvedAgent.systemPrompt?.trim()
  if (!system) return userPrompt
  return `## Agent instructions\n\n${system}\n\n## Task\n\n${userPrompt}`
}

/**
 * A chat round resumes the SAME agent's session (`sendTaskFeedback` copies
 * `agentRef` from the parent job), so the agent's instructions are already in
 * the conversation — re-sending the whole system prompt with every message is
 * pure noise and tokens.
 *
 * Keyed on `isChatFeedback` only, deliberately: that flag is stripped when
 * `advancePipelineStepChain` carries metadata into the next step, whereas
 * `parentJobId` leaks forward — and a pipeline step resuming the previous
 * step's session runs a DIFFERENT agent, whose instructions must be sent.
 */
function shouldSendAgentInstructions(req: ExecuteRequest): boolean {
  return !(req.resumeSessionId && req.metadata?.isChatFeedback === true)
}

export interface ClaudeInvocationInput {
  flags: string[]
  prompt: string
  allowedTools?: unknown
  dangerouslySkipPermissions?: unknown
  sessionId?: string
  resumeSessionId?: string
}

export interface ClaudeInvocation {
  args: string[]
  stdinInput: string
}

/** Pure builder for the Claude headless (`claude -p`) invocation.
 *
 * The prompt is delivered on STDIN, never as an argv element: `-p` is a boolean
 * print-mode flag and `claude -p` reads the prompt from stdin. Keeping the
 * (multi-line, whitespace-containing) prompt out of argv is what fixes the
 * Windows bug where `spawn(..., { shell: true })` space-joins argv without
 * quoting and cmd.exe splits the prompt — leaving `claude -p` with only its
 * first token. Every remaining argv element is a flag or a flag value with no
 * embedded whitespace, so it survives shell:true argv-joining intact. */
export function buildClaudeInvocation(input: ClaudeInvocationInput): ClaudeInvocation {
  const args = [...input.flags, '-p']
  if (input.allowedTools) {
    args.push('--allowedTools', String(input.allowedTools))
  }
  if (input.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }
  // Approval-flow session continuity — exactly one is ever set (see
  // ExecuteRequest.sessionId/resumeSessionId doc comment).
  if (input.sessionId) args.push('--session-id', input.sessionId)
  if (input.resumeSessionId) args.push('--resume', input.resumeSessionId)
  return { args, stdinInput: input.prompt }
}

/** --bare only supports ANTHROPIC_API_KEY; cli-session needs OAuth/keychain. */
function resolveEffectiveFlags(flags: unknown, credential: CredentialProfile): string[] {
  const list = Array.isArray(flags) ? [...flags] : []
  const auth = resolveSecretRef(credential)
  if (auth.type === 'cli-session') {
    return list.filter((f) => f !== '--bare')
  }
  return list
}

function buildChildEnv(credential: CredentialProfile): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const auth = resolveSecretRef(credential)
  if (auth.type === 'env' && auth.key && auth.value) {
    env[auth.key] = auth.value
  }
  return env
}

function formatFailure(procResult: ProcResult): string {
  const fromStreams = [procResult.stderr, procResult.stdout].filter(Boolean).join('\n').trim()
  if (fromStreams) return fromStreams.slice(0, 1000)
  if (procResult.killed) return 'process timed out'
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
  claudeStyle: boolean
  /** Final argv actually spawned (flags only when prompt goes via stdin). */
  argv?: string[]
  /** Prompt piped on stdin (Claude + Cursor parse-json) — never shown in CLI line. */
  promptViaStdin?: boolean
  allowedTools?: unknown
  dangerouslySkipPermissions?: unknown
  sessionId?: string
  resumeSessionId?: string
  prompt: string
  metadata?: Record<string, unknown>
}): string {
  const cli = [opts.cliPath]
  let promptNote = ''
  if (opts.promptViaStdin) {
    // Argv already holds flags only; prompt is below under "--- Prompt ---".
    if (opts.argv) {
      cli.push(...opts.argv)
    } else if (opts.claudeStyle) {
      // Fallback mirror when caller did not pass computed argv (legacy path).
      cli.push('-p')
      if (opts.allowedTools) cli.push('--allowedTools', String(opts.allowedTools))
      if (opts.dangerouslySkipPermissions) cli.push('--dangerously-skip-permissions')
      if (opts.sessionId) cli.push('--session-id', opts.sessionId)
      if (opts.resumeSessionId) cli.push('--resume', opts.resumeSessionId)
    } else {
      cli.push(...opts.flags)
    }
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

export interface LocalConsoleProviderOptions {
  providerId: string
  defaultCliPath: string
  /** When true, append -p prompt and Claude-style allowedTools flags. */
  claudeStyleArgs?: boolean
  /** How this provider captures/presets CLI session ids. */
  sessionCapture?: SessionCaptureMode
}

/** Shared Agent CLI spawn provider (Claude / Cursor / Codex) — not console-command. */
export function createLocalConsoleProvider(opts: LocalConsoleProviderOptions): AgentCliProvider {
  const claudeStyle = opts.claudeStyleArgs !== false && opts.providerId === 'claude-code-cli'
  const sessionCapture: SessionCaptureMode = opts.sessionCapture ?? 'none'

  return {
    providerId: opts.providerId,
    family: 'agent-cli',

    validateRunnerConfig(config) {
      const errors: string[] = []
      if (!config?.cliPath) errors.push('cliPath is required')
      return { ok: errors.length === 0, errors }
    },

    validateCredential(profile) {
      if (!profile?.secretRef) return { ok: false, errors: ['secretRef required'] }
      return { ok: true, errors: [] }
    },

    capabilities() {
      return {
        supportsAgentFile: opts.providerId === 'claude-code-cli',
        supportsStreaming: false,
        maxConcurrency: 1,
      }
    },

    agentCapabilities() {
      return {
        supportsAgentFile: opts.providerId === 'claude-code-cli',
        supportsStreaming: false,
        maxConcurrency: 1,
        sessionCapture,
        supportsTokenUsage: false,
      }
    },

    async execute(
      req: ExecuteRequest,
      runnerConfig: Record<string, any>,
      credential: CredentialProfile,
      onLog?: (chunk: string) => void,
      onStart?: (info: { pid: number | null }) => void,
    ): Promise<ExecuteResult> {
      const started = Date.now()
      const cliPath = String(runnerConfig.cliPath || opts.defaultCliPath)
      const flags = resolveEffectiveFlags(runnerConfig.flags, credential)
      const prompt = shouldSendAgentInstructions(req)
        ? buildPrompt(req.resolvedAgent, req.userPrompt)
        : req.userPrompt

      const sessionPlan = prepareSessionInvocation({
        capture: sessionCapture,
        sessionId: req.sessionId,
        resumeSessionId: req.resumeSessionId,
      })

      const useClaudeStyle = claudeStyle || opts.claudeStyleArgs === true
      // Headless `-p` with no TTY will hang forever if Claude waits for an
      // interactive tool-permission prompt. Default skip-permissions on unless
      // the runner config explicitly sets dangerouslySkipPermissions: false.
      const skipPermissions =
        useClaudeStyle &&
        runnerConfig.dangerouslySkipPermissions !== false &&
        runnerConfig.dangerouslySkipPermissions !== 'false'
      let args: string[]
      let stdinInput: string | undefined
      if (useClaudeStyle) {
        const invocation = buildClaudeInvocation({
          flags,
          prompt,
          allowedTools: runnerConfig.allowedTools,
          dangerouslySkipPermissions: skipPermissions,
          sessionId: sessionPlan.sessionId,
          resumeSessionId: sessionPlan.resumeSessionId,
        })
        args = invocation.args
        stdinInput = invocation.stdinInput
      } else if (sessionCapture === 'parse-json') {
        // Same Windows argv-splitting class as Claude: prompt must not be an
        // argv element under shell:true. Also pass --resume so multi-turn NL
        // chat (and approval feedback) keeps the captured session_id.
        const invocation = buildCursorJsonInvocation({
          flags,
          prompt,
          resumeSessionId: sessionPlan.resumeSessionId,
        })
        args = invocation.args
        stdinInput = invocation.stdinInput
      } else {
        args = [...flags, prompt]
      }

      const logPath = req.metadata?.logPath as string | undefined
      const appendLog = (text: string) => {
        if (!logPath) return
        try {
          appendTextFileSync(logPath, text)
        } catch {
          /* ignore */
        }
      }

      appendLog(
        describePayload({
          resolvedAgent: req.resolvedAgent,
          workspace: req.workspace,
          cliPath,
          flags,
          claudeStyle: useClaudeStyle,
          argv: args,
          promptViaStdin: stdinInput != null,
          allowedTools: runnerConfig.allowedTools,
          dangerouslySkipPermissions: skipPermissions,
          sessionId: sessionPlan.sessionId,
          resumeSessionId: sessionPlan.resumeSessionId,
          prompt,
          metadata: req.metadata,
        }),
      )

      const wrappedOnLog = (chunk: string) => {
        onLog?.(chunk)
        appendLog(chunk)
      }

      const wrappedOnStart = (info: { pid: number | null }) => {
        onStart?.(info)
        // So the UI delta stream is not stuck on an empty "=== Phản hồi ==="
        // section while the CLI is still thinking / using tools.
        appendLog(`[runner] process started pid=${info.pid ?? 'null'} — chờ stdout/stderr…\n`)
      }

      let procResult: ProcResult
      try {
        procResult = await runProcess(cliPath, args, {
          cwd: req.workspace,
          env: buildChildEnv(credential),
          timeoutMs: req.timeoutMs || runnerConfig.timeoutMs || 600_000,
          onLog: wrappedOnLog,
          onStart: wrappedOnStart,
          stdinInput,
        })
      } catch (err: any) {
        const result: ExecuteResult = {
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          logPath,
          error: String(err.message || err),
        }
        appendLog(describeResult(result))
        return result
      }

      const artifactsFound: string[] = []
      if (req.produces?.length) {
        for (const name of req.produces) {
          const fp = joinPath(req.workspace, name)
          if (existsSync(fp)) artifactsFound.push(name)
        }
      }

      const ok = procResult.exitCode === 0 && !procResult.killed
      let stdout = procResult.stdout
      let capturedSessionId: string | null | undefined = sessionPlan.presetSessionId ?? undefined
      let tokenUsage: ExecuteResult['tokenUsage']

      if (sessionCapture === 'parse-json') {
        const parsed = parseCursorJsonOutput(procResult.stdout)
        if (parsed.result != null) stdout = parsed.result
        if (parsed.session_id) capturedSessionId = parsed.session_id
        if (parsed.usage) {
          const total =
            parsed.usage.inputTokens +
            parsed.usage.outputTokens +
            parsed.usage.cacheReadTokens +
            parsed.usage.cacheWriteTokens
          tokenUsage = {
            inputTokens: parsed.usage.inputTokens,
            outputTokens: parsed.usage.outputTokens,
            cacheReadTokens: parsed.usage.cacheReadTokens,
            cacheWriteTokens: parsed.usage.cacheWriteTokens,
            totalTokens: total,
            model: parsed.model,
          }
        }
      }

      const result: ExecuteResult = {
        ok,
        exitCode: procResult.exitCode,
        durationMs: Date.now() - started,
        logPath,
        artifactsFound,
        error: ok ? undefined : formatFailure(procResult),
        stdout,
        sessionId: capturedSessionId,
        tokenUsage,
      }
      appendLog(describeResult(result))
      return result
    },
  }
}

export function createClaudeCodeCliProvider(): AgentCliProvider {
  return createLocalConsoleProvider({
    providerId: 'claude-code-cli',
    defaultCliPath: 'claude',
    claudeStyleArgs: true,
    sessionCapture: 'preset-uuid',
  })
}
