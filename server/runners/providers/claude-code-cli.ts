import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { CredentialProfile, ExecuteRequest, ExecuteResult, RunnerProvider } from '../types.js'
import { buildChildEnv, buildClaudeArgv, buildPrompt } from './claude-shared.js'

interface ProcResult {
  exitCode: number | null
  stdout: string
  stderr: string
  killed: boolean
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

export function createClaudeCodeCliProvider(): RunnerProvider {
  return {
    providerId: 'claude-code-cli',

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
      return { supportsAgentFile: true, supportsStreaming: false, maxConcurrency: 1 }
    },

    async execute(
      req: ExecuteRequest,
      runnerConfig: Record<string, unknown>,
      credential: CredentialProfile,
      onLog?: (chunk: string) => void,
    ): Promise<ExecuteResult> {
      const started = Date.now()
      const cliPath = String(runnerConfig.cliPath || 'claude')
      const prompt = buildPrompt(req.resolvedAgent, req.userPrompt)
      const args = buildClaudeArgv({ runnerConfig, credential, prompt })

      const logPath = req.metadata?.logPath as string | undefined
      const wrappedOnLog = (chunk: string) => {
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
          timeoutMs: req.timeoutMs || (runnerConfig.timeoutMs as number) || 600_000,
          onLog: wrappedOnLog,
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          logPath,
          error: message,
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
