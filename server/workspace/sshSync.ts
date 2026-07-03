import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { SshRunnerConfigSchema } from '../../shared/schemas/runner-ssh.js'
import { resolveSecretRef } from '../runners/credentials.js'
import { getRunner } from '../runners/registry.js'
import type { CredentialProfile } from '../runners/types.js'
import type { Project, ProjectRemote } from '../registry.js'
import { updateProjectRemoteSync } from '../registry.js'
import type { RunnerConfig } from '../runners/types.js'

export type ExecRsync = (
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<{ code: number; stderr: string; stdout?: string }>

export type ExecSsh = (
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<{ code: number; stdout: string; stderr: string; latencyMs: number }>

export function shellQuoteSingle(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function escapeRemoteShell(cmd: string): string {
  return shellQuoteSingle(cmd)
}

export function buildSshArgs(opts: {
  config: { port?: number; connectTimeoutMs?: number; knownHostsFile?: string }
  keyPath: string
  remoteTarget: string
  remoteCommand: string
}): string[] {
  const connectTimeoutSec = Math.ceil((opts.config.connectTimeoutMs || 30_000) / 1000)
  const args = [
    '-i',
    opts.keyPath,
    '-p',
    String(opts.config.port || 22),
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${connectTimeoutSec}`,
    '-o',
    'StrictHostKeyChecking=yes',
  ]
  if (opts.config.knownHostsFile) {
    args.push('-o', `UserKnownHostsFile=${opts.config.knownHostsFile}`)
  }
  args.push(opts.remoteTarget, opts.remoteCommand)
  return args
}

function spawnBinary(
  binary: string,
  args: string[],
  stubScriptEnv: string | undefined,
): ReturnType<typeof spawn> {
  if (stubScriptEnv && process.env[stubScriptEnv]) {
    return spawn(process.execPath, [process.env[stubScriptEnv]!, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }
  return spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function defaultExecSsh(sshBinary: string): ExecSsh {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const child = spawnBinary(sshBinary, args, 'SSH_STUB_SCRIPT')
      child.stdin?.end()

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (c) => {
        stdout += String(c)
      })
      child.stderr?.on('data', (c) => {
        stderr += String(c)
      })

      const timeoutMs = opts.timeoutMs ?? 30_000
      let killed = false
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              killed = true
              child.kill('SIGTERM')
            }, timeoutMs)
          : null

      child.on('error', (err) => {
        if (timer) clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        if (timer) clearTimeout(timer)
        resolve({
          code: killed ? -1 : code ?? 1,
          stdout,
          stderr,
          latencyMs: Date.now() - started,
        })
      })
    })
}

function defaultExecRsync(rsyncBinary: string): ExecRsync {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      const child = spawnBinary(rsyncBinary, args, 'RSYNC_STUB_SCRIPT')
      let stderr = ''
      let stdout = ''
      child.stderr?.on('data', (c) => {
        stderr += String(c)
      })
      child.stdout?.on('data', (c) => {
        stdout += String(c)
      })

      const timeoutMs = opts.timeoutMs ?? 120_000
      let killed = false
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              killed = true
              child.kill('SIGTERM')
            }, timeoutMs)
          : null

      child.on('error', (err) => {
        if (timer) clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        if (timer) clearTimeout(timer)
        resolve({ code: killed ? -1 : code ?? 1, stderr, stdout })
      })
    })
}

function resolveKeyPath(credential: CredentialProfile): string | null {
  const auth = resolveSecretRef(credential)
  if (auth.type !== 'file') return null
  return auth.path
}

export function resolveSshTarget(project: Project, runner: RunnerConfig): string {
  if (project.remote && project.remote.runnerId !== runner.id) {
    console.warn(
      `[sshSync] project ${project.id} runnerId ${project.remote.runnerId} !== runner ${runner.id}`,
    )
  }
  const parsed = SshRunnerConfigSchema.safeParse(runner.config)
  if (!parsed.success) throw new Error('invalid SSH runner config')
  return `${parsed.data.user}@${parsed.data.host}`
}

function buildRsyncSshTransport(config: ReturnType<typeof SshRunnerConfigSchema.parse>, keyPath: string): string {
  const parts = [
    'ssh',
    '-i',
    keyPath,
    '-p',
    String(config.port || 22),
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
  ]
  if (config.knownHostsFile) {
    parts.push('-o', `UserKnownHostsFile=${config.knownHostsFile}`)
  }
  return parts.join(' ')
}

export async function testSshConnection(opts: {
  runner: RunnerConfig
  credential: CredentialProfile
  execSsh?: ExecSsh
}): Promise<{ ok: true; message: string; latencyMs: number } | { ok: false; error: string }> {
  const parsed = SshRunnerConfigSchema.safeParse(opts.runner.config)
  if (!parsed.success) {
    return { ok: false, error: 'invalid SSH runner config' }
  }
  const config = parsed.data
  const keyPath = resolveKeyPath(opts.credential)
  if (!keyPath) return { ok: false, error: 'SSH requires file: credential' }

  const sshBinary = process.env.SSH_BINARY || config.sshBinary || 'ssh'
  const execSsh = opts.execSsh ?? defaultExecSsh(sshBinary)
  const remoteTarget = `${config.user}@${config.host}`
  const args = buildSshArgs({
    config,
    keyPath,
    remoteTarget,
    remoteCommand: 'echo ok',
  })

  try {
    const result = await execSsh(args, { timeoutMs: config.connectTimeoutMs })
    if (result.code === 0) {
      return { ok: true, message: 'connection ok', latencyMs: result.latencyMs }
    }
    return { ok: false, error: (result.stderr || result.stdout || 'connection failed').slice(0, 500) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

type PullResult =
  | { ok: true; lastSyncedAt: string; filesCopied?: number }
  | { ok: false; error: string }

export async function pullArtifacts(opts: {
  project: Project
  runner: RunnerConfig
  credential: CredentialProfile
  taskIds?: string[]
  execRsync?: ExecRsync
}): Promise<PullResult> {
  if (opts.project.kind !== 'ssh' || !opts.project.remote) {
    return { ok: false, error: 'project is not SSH kind' }
  }

  const parsed = SshRunnerConfigSchema.safeParse(opts.runner.config)
  if (!parsed.success) {
    return { ok: false, error: 'invalid SSH runner config' }
  }
  const config = parsed.data
  const keyPath = resolveKeyPath(opts.credential)
  if (!keyPath) return { ok: false, error: 'SSH requires file: credential' }

  const remote = opts.project.remote
  const remoteRoot = opts.project.path.replace(/\/+$/, '')
  const localCache = remote.artifactCache
  const sshTarget = `${config.user}@${config.host}`
  const rsyncBinary = process.env.RSYNC_BINARY || config.rsyncBinary || 'rsync'
  const execRsync = opts.execRsync ?? defaultExecRsync(rsyncBinary)
  const transport = buildRsyncSshTransport(config, keyPath)
  const timeoutMs = config.rsyncTimeoutMs || 120_000

  const syncPaths: { rel: string; delete?: boolean; optional?: boolean }[] = [
    { rel: '.dev-state/', delete: true },
    { rel: 'tasks/', delete: true },
    { rel: 'pipeline.yaml', optional: true },
    { rel: 'knowledge.config.yaml', optional: true },
    { rel: 'knowledge/', optional: true },
  ]

  fs.mkdirSync(localCache, { recursive: true })

  for (const item of syncPaths) {
    const remoteSrc = `${sshTarget}:${remoteRoot}/${item.rel}`
    const localDest = path.join(localCache, item.rel)
    if (item.rel.endsWith('/')) {
      fs.mkdirSync(localDest, { recursive: true })
    } else {
      fs.mkdirSync(path.dirname(localDest), { recursive: true })
    }

    const args = ['-az', '-e', transport]
    if (item.delete) args.push('--delete')
    args.push(remoteSrc, localDest.endsWith(path.sep) || item.rel.endsWith('/') ? localDest : localDest)

    try {
      const result = await execRsync(args, { timeoutMs })
      if (result.code !== 0) {
        if (item.optional) continue
        const errMsg = (result.stderr || 'rsync failed').slice(0, 500)
        updateProjectRemoteSync(opts.project.id, { lastSyncError: errMsg })
        return { ok: false, error: errMsg }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (item.optional) continue
      updateProjectRemoteSync(opts.project.id, { lastSyncError: message })
      return { ok: false, error: message }
    }
  }

  const lastSyncedAt = new Date().toISOString()
  updateProjectRemoteSync(opts.project.id, { lastSyncedAt, lastSyncError: null })
  return { ok: true, lastSyncedAt }
}

export function getRunnerForProject(project: Project): RunnerConfig | null {
  if (!project.remote?.runnerId) return null
  return getRunner(project.remote.runnerId)
}

export type { ProjectRemote }
