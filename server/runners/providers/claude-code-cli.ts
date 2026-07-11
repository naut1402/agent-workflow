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
  prompt: string
}): string {
  const cli = [opts.cliPath, ...opts.flags]
  if (opts.claudeStyle) {
    cli.push('-p', '<prompt — xem "--- Prompt ---" bên dưới>')
    if (opts.allowedTools) cli.push('--allowedTools', String(opts.allowedTools))
    if (opts.dangerouslySkipPermissions) cli.push('--dangerously-skip-permissions')
  } else {
    cli.push('<prompt — xem "--- Prompt ---" bên dưới>')
  }
  const agent = opts.resolvedAgent
  const agentLabel = agent.ref
    ? `${agent.ref}${agent.name ? ` (${agent.name})` : ''}`
    : `${agent.name || 'ad-hoc'} — không gắn agent, chạy prompt trực tiếp`
  return [
    '=== Payload gửi cho runner ===',
    `Agent: ${agentLabel}${agent.model ? ` — model: ${agent.model}` : ''}`,
    `Workspace: ${opts.workspace}`,
    `CLI: ${cli.join(' ')}`,
    '--- Prompt ---',
    opts.prompt,
    '',
    '=== Phản hồi của runner (stdout/stderr) ===',
    '',
  ].join('\n')
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
}

function runProcess(cliPath: string, args: string[], options: RunProcessOptions): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    child.stdin?.end()

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

      let args: string[]
      if (claudeStyle || opts.claudeStyleArgs === true) {
        args = [...flags, '-p', prompt]
        if (runnerConfig.allowedTools) {
          args.push('--allowedTools', String(runnerConfig.allowedTools))
        }
        if (runnerConfig.dangerouslySkipPermissions) {
          args.push('--dangerously-skip-permissions')
        }
      } else {
        // Generic local CLI: user flags + prompt as final arg.
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
          claudeStyle: claudeStyle || opts.claudeStyleArgs === true,
          allowedTools: runnerConfig.allowedTools,
          dangerouslySkipPermissions: runnerConfig.dangerouslySkipPermissions,
          prompt,
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
