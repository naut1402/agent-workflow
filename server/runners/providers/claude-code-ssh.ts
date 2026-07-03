import { spawn, type SpawnOptions } from 'node:child_process'
import fs from 'node:fs'
import { SshRunnerConfigSchema } from '../../../shared/schemas/runner-ssh.js'
import { resolveSecretRef, validateSshKeyFile } from '../credentials.js'
import { buildSshArgs, escapeRemoteShell, shellQuoteSingle } from '../../workspace/sshSync.js'
import type { CredentialProfile, ExecuteRequest, ExecuteResult, ResolvedAgent, RunnerProvider } from '../types.js'
import { buildClaudeArgv, buildPrompt } from './claude-shared.js'

export type SpawnFn = typeof spawn

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

function joinArgv(argv: string[]): string {
  return argv.map((a) => (/\s/.test(a) ? shellQuoteSingle(a) : a)).join(' ')
}

function runSsh(
  sshBinary: string,
  args: string[],
  options: { timeoutMs: number; onLog?: (chunk: string) => void },
  spawnFn: SpawnFn,
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const stubScript = process.env.SSH_STUB_SCRIPT
    const child = stubScript
      ? spawnFn(process.execPath, [stubScript, ...args], { stdio: ['pipe', 'pipe', 'pipe'] } as SpawnOptions)
      : spawnFn(sshBinary, args, { stdio: ['pipe', 'pipe', 'pipe'] } as SpawnOptions)

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

export function createClaudeCodeSshProvider(deps?: { spawnFn?: SpawnFn }): RunnerProvider {
  const spawnFn = deps?.spawnFn ?? spawn

  return {
    providerId: 'claude-code-ssh',

    validateRunnerConfig(config) {
      const parsed = SshRunnerConfigSchema.safeParse(config || {})
      if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        return { ok: false, errors }
      }
      return { ok: true, errors: [] }
    },

    validateCredential(profile) {
      if (!profile?.secretRef) return { ok: false, errors: ['secretRef required'] }
      const auth = resolveSecretRef(profile)
      if (auth.type !== 'file') {
        return { ok: false, errors: ['SSH runner requires file: secretRef'] }
      }
      validateSshKeyFile(auth.path)
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
      const parsed = SshRunnerConfigSchema.safeParse(runnerConfig)
      if (!parsed.success) {
        return {
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        }
      }
      const config = parsed.data

      const auth = resolveSecretRef(credential)
      if (auth.type !== 'file') {
        return {
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          error: 'SSH runner requires file: credential',
        }
      }

      const prompt = buildPrompt(req.resolvedAgent, req.userPrompt)
      const argv = buildClaudeArgv({ runnerConfig, credential, prompt })
      const remoteCli = config.remoteCliPath || 'claude'
      const remoteWorkspace = req.workspace
      const remoteCmd = `cd ${escapeRemoteShell(remoteWorkspace)} && ${remoteCli} ${joinArgv(argv)}`

      const sshBinary = process.env.SSH_BINARY || config.sshBinary || 'ssh'
      const remoteTarget = `${config.user}@${config.host}`
      const sshArgs = buildSshArgs({
        config,
        keyPath: auth.path,
        remoteTarget,
        remoteCommand: remoteCmd,
      })

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
        procResult = await runSsh(
          sshBinary,
          sshArgs,
          {
            timeoutMs: req.timeoutMs || config.connectTimeoutMs || 600_000,
            onLog: wrappedOnLog,
          },
          spawnFn,
        )
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

      const ok = procResult.exitCode === 0 && !procResult.killed
      return {
        ok,
        exitCode: procResult.exitCode,
        durationMs: Date.now() - started,
        logPath,
        artifactsFound: [],
        error: ok ? undefined : formatFailure(procResult, logPath),
      }
    },
  }
}
