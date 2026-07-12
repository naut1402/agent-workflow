import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSecretRef } from '../credentials.js'
import type { CredentialProfile, ExecuteRequest, ExecuteResult, ResolvedAgent, RunnerProvider } from '../types.js'

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
  allowedTools?: unknown
  dangerouslySkipPermissions?: unknown
  sessionId?: string
  resumeSessionId?: string
  prompt: string
  metadata?: Record<string, unknown>
}): string {
  const cli = [opts.cliPath, ...opts.flags]
  let promptNote: string
  if (opts.claudeStyle) {
    // Mirror buildClaudeInvocation: `-p` + flags in argv; the prompt itself is
    // piped to stdin (not an argv element), so it is NOT shown in the CLI line.
    cli.push('-p')
    if (opts.allowedTools) cli.push('--allowedTools', String(opts.allowedTools))
    if (opts.dangerouslySkipPermissions) cli.push('--dangerously-skip-permissions')
    if (opts.sessionId) cli.push('--session-id', opts.sessionId)
    if (opts.resumeSessionId) cli.push('--resume', opts.resumeSessionId)
    promptNote = '(prompt gửi qua stdin — xem "--- Prompt ---" bên dưới)'
  } else {
    cli.push('<prompt — xem "--- Prompt ---" bên dưới>')
    promptNote = ''
  }
  const agent = opts.resolvedAgent
  const agentLabel = agent.ref
    ? `${agent.ref}${agent.name ? ` (${agent.name})` : ''}`
    : `${agent.name || 'ad-hoc'} — không gắn agent, chạy prompt trực tiếp`
  const lines = [
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
  const lines = [
    '',
    '=== Kết quả ===',
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode ?? 'null'}`,
    `durationMs: ${result.durationMs}`,
  ]
  if (result.artifactsFound?.length) lines.push(`artifactsFound: ${result.artifactsFound.join(', ')}`)
  if (result.error) lines.push(`error: ${result.error}`)
  return lines.join('\n') + '\n'
}

interface RunProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  onLog?: (chunk: string) => void
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
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

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
}

/** Shared local-console spawn provider (Claude / Cursor / Codex). */
export function createLocalConsoleProvider(opts: LocalConsoleProviderOptions): RunnerProvider {
  const claudeStyle = opts.claudeStyleArgs !== false && opts.providerId === 'claude-code-cli'

  return {
    providerId: opts.providerId,

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

    async execute(
      req: ExecuteRequest,
      runnerConfig: Record<string, any>,
      credential: CredentialProfile,
      onLog?: (chunk: string) => void,
    ): Promise<ExecuteResult> {
      const started = Date.now()
      const cliPath = String(runnerConfig.cliPath || opts.defaultCliPath)
      const flags = resolveEffectiveFlags(runnerConfig.flags, credential)
      const prompt = buildPrompt(req.resolvedAgent, req.userPrompt)

      const useClaudeStyle = claudeStyle || opts.claudeStyleArgs === true
      let args: string[]
      let stdinInput: string | undefined
      if (useClaudeStyle) {
        // Claude headless: prompt goes to stdin (see buildClaudeInvocation), so
        // it never becomes an argv element that shell:true would mangle on
        // Windows. args holds only whitespace-free flags/values.
        const invocation = buildClaudeInvocation({
          flags,
          prompt,
          allowedTools: runnerConfig.allowedTools,
          dangerouslySkipPermissions: runnerConfig.dangerouslySkipPermissions,
          sessionId: req.sessionId,
          resumeSessionId: req.resumeSessionId,
        })
        args = invocation.args
        stdinInput = invocation.stdinInput
      } else {
        // Generic local CLI (Cursor/Codex): user flags + prompt as final arg.
        // NOTE: this shares the claude Windows argv-quoting hazard — a
        // multi-line/whitespace prompt can be split by cmd.exe under
        // shell:true. We keep argv delivery here because these CLIs are not
        // verified to read the prompt from stdin; passing it on stdin could
        // hang a CLI that only reads argv. Follow-up: confirm per-CLI stdin
        // support, then migrate. (Out of scope for the claude-code-cli fix.)
        args = [...flags, prompt]
      }

      const logPath = req.metadata?.logPath as string | undefined
      const appendLog = (text: string) => {
        if (!logPath) return
        try {
          fs.appendFileSync(logPath, text)
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
          allowedTools: runnerConfig.allowedTools,
          dangerouslySkipPermissions: runnerConfig.dangerouslySkipPermissions,
          sessionId: req.sessionId,
          resumeSessionId: req.resumeSessionId,
          prompt,
          metadata: req.metadata,
        }),
      )

      const wrappedOnLog = (chunk: string) => {
        onLog?.(chunk)
        appendLog(chunk)
      }

      let procResult: ProcResult
      try {
        procResult = await runProcess(cliPath, args, {
          cwd: req.workspace,
          env: buildChildEnv(credential),
          timeoutMs: req.timeoutMs || runnerConfig.timeoutMs || 600_000,
          onLog: wrappedOnLog,
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
          const fp = path.join(req.workspace, name)
          if (fs.existsSync(fp)) artifactsFound.push(name)
        }
      }

      const ok = procResult.exitCode === 0 && !procResult.killed
      const result: ExecuteResult = {
        ok,
        exitCode: procResult.exitCode,
        durationMs: Date.now() - started,
        logPath,
        artifactsFound,
        error: ok ? undefined : formatFailure(procResult),
        // Captured so an approval quick action can use "respond with the edited
        // content" style prompts (stdout) instead of requiring a file write.
        stdout: procResult.stdout,
      }
      appendLog(describeResult(result))
      return result
    },
  }
}

export function createClaudeCodeCliProvider(): RunnerProvider {
  return createLocalConsoleProvider({
    providerId: 'claude-code-cli',
    defaultCliPath: 'claude',
    claudeStyleArgs: true,
  })
}
