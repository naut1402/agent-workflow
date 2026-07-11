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

function formatFailure(procResult: ProcResult, logPath?: string): string {
  const fromStreams = [procResult.stderr, procResult.stdout].filter(Boolean).join('\n').trim()
  if (fromStreams) return fromStreams.slice(0, 1000)
  if (logPath && fs.existsSync(logPath)) {
    const log = fs.readFileSync(logPath, 'utf8').trim()
    if (log) return log.slice(0, 1000)
  }
  if (procResult.killed) return 'process timed out'
  return `exit code ${procResult.exitCode ?? 'unknown'}`
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
      const logChunks: string[] = []

      const wrappedOnLog = (chunk: string) => {
        logChunks.push(chunk)
        onLog?.(chunk)
        if (logPath) {
          try {
            fs.appendFileSync(logPath, chunk)
          } catch {
            /* ignore */
          }
        }
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
        return {
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          logPath,
          error: String(err.message || err),
        }
      }

      const artifactsFound: string[] = []
      if (req.produces?.length) {
        for (const name of req.produces) {
          const fp = path.join(req.workspace, name)
          if (fs.existsSync(fp)) artifactsFound.push(name)
        }
      }

      const ok = procResult.exitCode === 0 && !procResult.killed
      return {
        ok,
        exitCode: procResult.exitCode,
        durationMs: Date.now() - started,
        logPath,
        artifactsFound,
        error: ok ? undefined : formatFailure(procResult, logPath),
      }
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
