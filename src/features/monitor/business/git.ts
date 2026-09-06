/**
 * Shared git process helpers for the monitor feature (clone, worktree, …).
 */

import type { SpawnSyncReturns } from '../../../core/lib/processHelper.js'
import { spawnSync } from '../../../core/lib/processHelper.js'
import { existsSync, joinPath } from '../../../core/lib/fileHelper.js'

/** Local read command (`worktree list`, `status`) — hanging longer is abnormal. */
export const GIT_READ_TIMEOUT_MS = 10_000
/** Local write command (`worktree remove`, `prune`) — may delete a large tree. */
export const GIT_WRITE_TIMEOUT_MS = 30_000
/** Clone over the network — the original cloneProject budget. */
export const GIT_CLONE_TIMEOUT_MS = 300_000

/** Prefer real git.exe on Windows when PATH is incomplete (IDE-launched servers). */
export function resolveGitCommand(): string {
  if (process.platform !== 'win32') return 'git'
  const candidates = [
    process.env.GIT_EXEC_PATH && joinPath(process.env.GIT_EXEC_PATH, 'git.exe'),
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return 'git'
}

export interface RunGitOptions {
  cwd?: string
  /** Defaults to GIT_READ_TIMEOUT_MS — write/network call sites MUST pass their own. */
  timeout?: number
  env?: NodeJS.ProcessEnv
}

export function runGit(args: string[], opts: RunGitOptions = {}): SpawnSyncReturns<string> {
  // Never shell:true — argv is joined into a shell string and user-controlled
  // cloneUrl / extraHeader / worktree path would become command-injection
  // / token-leak surfaces.
  return spawnSync(resolveGitCommand(), args, {
    encoding: 'utf8' as const,
    windowsHide: true,
    timeout: opts.timeout ?? GIT_READ_TIMEOUT_MS,
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  })
}

/** Human-readable failure for a git run; `op` names the operation in the message. */
export function formatGitFailure(result: SpawnSyncReturns<string>, op = 'git'): string {
  const spawnErr = result.error as NodeJS.ErrnoException | undefined
  if (spawnErr?.code === 'ENOENT') {
    return 'Không tìm thấy git trên PATH. Cài Git for Windows hoặc mở terminal có git rồi chạy lại dashboard.'
  }
  if (spawnErr) return `git spawn failed: ${spawnErr.message}`
  if (result.signal) return `${op} killed (${result.signal})`
  const out = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
  if (out) return out
  return `${op} thất bại (exit ${result.status ?? 'unknown'})`
}
