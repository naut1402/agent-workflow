import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../types.js'

interface ProcResult {
  exitCode: number | null
  stdout: string
  stderr: string
  killed: boolean
}

/**
 * Split a free-form command-line string into argv tokens.
 * Supports single/double quotes; backslash escapes the next character.
 * Empty / whitespace-only input → [].
 */
export function splitCommandArgs(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  for (const ch of input) {
    if (escaped) {
      cur += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (escaped) cur += '\\'
  if (cur) out.push(cur)
  return out
}

export interface ConsoleInvocationInput {
  flags?: string[]
  /** Extra argv from the job prompt — shell-split, not wrapped as one blob. */
  userPrompt?: string
}

export interface ConsoleInvocation {
  args: string[]
}

/** Pure builder: `cliPath [...flags] [...split(userPrompt)]` — no AI agent flags. */
export function buildConsoleInvocation(input: ConsoleInvocationInput): ConsoleInvocation {
  const flags = Array.isArray(input.flags) ? input.flags.map(String) : []
  const extra = input.userPrompt?.trim() ? splitCommandArgs(input.userPrompt.trim()) : []
  return { args: [...flags, ...extra] }
}

function formatFailure(procResult: ProcResult): string {
  const fromStreams = [procResult.stderr, procResult.stdout].filter(Boolean).join('\n').trim()
  if (fromStreams) return fromStreams.slice(0, 1000)
  if (procResult.killed) return 'process timed out'
  return `exit code ${procResult.exitCode ?? 'unknown'}`
}

function describePayload(opts: {
  workspace: string
  cliPath: string
  args: string[]
  userPrompt: string
}): string {
  const lines = [
    '=== Payload gửi cho runner ===',
    'Mode: console-command (argv thuần, không agent / allowedTools)',
    `Workspace: ${opts.workspace}`,
    `CLI: ${[opts.cliPath, ...opts.args].join(' ')}`,
  ]
  if (opts.userPrompt.trim()) {
    lines.push('--- Extra args (từ prompt) ---', opts.userPrompt.trim())
  }
  lines.push('', '=== Phản hồi của runner (stdout/stderr) ===', '')
  return lines.join('\n')
}

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

function runProcess(
  cliPath: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    timeoutMs: number
    onLog?: (chunk: string) => void
    onStart?: (info: { pid: number | null }) => void
  },
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    options.onStart?.({ pid: child.pid ?? null })

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

/**
 * Generic local console command — spawn `cliPath` with connection flags +
 * shell-split job prompt as argv. Does not inject AI agent system prompts,
 * `-p`, or `--allowedTools`.
 */
export function createConsoleCommandProvider(): RunnerProvider {
  return {
    providerId: 'console-command',

    validateRunnerConfig(config) {
      const errors: string[] = []
      if (!config?.cliPath) errors.push('cliPath is required')
      return { ok: errors.length === 0, errors }
    },

    validateCredential() {
      // local-console jobs use an implicit cli-session credential — nothing to validate.
      return { ok: true, errors: [] }
    },

    capabilities() {
      return {
        supportsAgentFile: false,
        supportsStreaming: false,
        maxConcurrency: 1,
      }
    },

    async execute(req: ExecuteRequest, runnerConfig: Record<string, any>, _credential, onLog?, onStart?): Promise<ExecuteResult> {
      const started = Date.now()
      const cliPath = String(runnerConfig.cliPath || 'sh')
      const flags = Array.isArray(runnerConfig.flags) ? runnerConfig.flags.map(String) : []
      // Ignore resolvedAgent.systemPrompt — console commands are not AI agents.
      const { args } = buildConsoleInvocation({ flags, userPrompt: req.userPrompt || '' })

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
          workspace: req.workspace,
          cliPath,
          args,
          userPrompt: req.userPrompt || '',
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
          env: { ...process.env },
          timeoutMs: req.timeoutMs || runnerConfig.timeoutMs || 600_000,
          onLog: wrappedOnLog,
          onStart,
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
        stdout: procResult.stdout,
      }
      appendLog(describeResult(result))
      return result
    },
  }
}
