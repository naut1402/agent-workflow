import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { registryHome } from '../registry.js'

export interface RunGitResult {
  stdout: string
  stderr: string
}

export type RunGitFn = (args: string[], opts: { cwd?: string; timeoutMs?: number }) => Promise<RunGitResult>

const DEFAULT_TIMEOUT_MS = 120_000

export function workspaceDir(id: string): string {
  return path.join(registryHome(), 'workspaces', id)
}

export async function defaultRunGit(
  args: string[],
  { cwd, timeoutMs = DEFAULT_TIMEOUT_MS }: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunGitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) {
        reject(new Error('git command timed out'))
        return
      }
      if (code !== 0) {
        const msg = [stderr, stdout].filter(Boolean).join('\n').trim() || `git exit ${code}`
        reject(new Error(msg))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

export async function cloneShallow(opts: {
  url: string
  branch: string
  targetDir: string
  runGit?: RunGitFn
}): Promise<void> {
  const run = opts.runGit ?? defaultRunGit
  fs.mkdirSync(path.dirname(opts.targetDir), { recursive: true })
  await run(['clone', '--depth', '1', '-b', opts.branch, opts.url, opts.targetDir], {
    cwd: path.dirname(opts.targetDir),
  })
}

export function cleanupWorkspace(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

export async function pullOrReclone(opts: {
  cloneRoot: string
  url: string
  branch: string
  runGit?: RunGitFn
}): Promise<'pulled' | 'recloned'> {
  const run = opts.runGit ?? defaultRunGit
  try {
    await run(['pull', 'origin', opts.branch], { cwd: opts.cloneRoot })
    return 'pulled'
  } catch {
    cleanupWorkspace(opts.cloneRoot)
    await cloneShallow({
      url: opts.url,
      branch: opts.branch,
      targetDir: opts.cloneRoot,
      runGit: run,
    })
    return 'recloned'
  }
}
