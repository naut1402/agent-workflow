import fs from 'node:fs'
import path from 'node:path'
import { validateGitUrl } from '../../shared/git/url.js'
import type { Project } from '../../shared/schemas/project.js'
import { defaultRunGit, type RunGitFn } from './workspace.js'

export const DEFAULT_PUSH_MESSAGE = 'chore(dev-team): sync orchestrator artifacts'

/** Walk từ startDir lên đến khi gặp .git/ hoặc hết filesystem. */
export function findGitRoot(startDir: string): string | null {
  let dir = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Relative path .dev-team-agent từ git root (cho git add). */
export function resolveDevTeamRelativePath(projectPath: string, gitRoot: string): string {
  const rel = path.relative(gitRoot, path.resolve(projectPath))
  if (rel === '.dev-team-agent' || rel.endsWith(`${path.sep}.dev-team-agent`)) {
    return rel.split(path.sep).slice(-2).join('/')
  }
  if (path.basename(projectPath) === '.dev-team-agent') {
    return path.relative(gitRoot, projectPath).replace(/\\/g, '/')
  }
  throw new Error('project path is not under a .dev-team-agent directory')
}

export type PushResult =
  | { ok: true; pushed: boolean; commit?: string; branch: string }
  | { ok: false; status: number; error: string }

export async function pushDevTeamArtifacts(opts: {
  gitRoot: string
  devTeamRel: string
  branch: string
  message?: string
  runGit?: RunGitFn
}): Promise<PushResult> {
  const run = opts.runGit ?? defaultRunGit
  const cwd = opts.gitRoot
  const msg = opts.message?.trim() || DEFAULT_PUSH_MESSAGE

  await run(['add', '--', opts.devTeamRel], { cwd })

  const status = await run(['status', '--porcelain', '--', opts.devTeamRel], { cwd })
  if (!status.stdout.trim()) {
    return { ok: true, pushed: false, branch: opts.branch }
  }

  await run(['commit', '-m', msg], { cwd })
  const rev = await run(['rev-parse', 'HEAD'], { cwd })
  await run(['push', 'origin', opts.branch], { cwd })
  return { ok: true, pushed: true, commit: rev.stdout.trim(), branch: opts.branch }
}

export async function pushGitWorkspace(
  project: Project,
  opts?: { message?: string; runGit?: RunGitFn },
): Promise<PushResult> {
  const gitRoot = findGitRoot(project.path)
  if (!gitRoot) {
    return { ok: false, status: 400, error: 'project path is not inside a git repository' }
  }

  const run = opts?.runGit ?? defaultRunGit
  let devTeamRel: string
  try {
    devTeamRel = resolveDevTeamRelativePath(project.path, gitRoot)
  } catch (e) {
    return { ok: false, status: 400, error: String((e as Error).message) }
  }

  let originUrl: string
  try {
    const r = await run(['remote', 'get-url', 'origin'], { cwd: gitRoot })
    originUrl = r.stdout.trim()
  } catch {
    return { ok: false, status: 400, error: 'git remote origin not configured' }
  }

  const branchRes = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitRoot })
  const branch = branchRes.stdout.trim()
  if (!branch || branch === 'HEAD') {
    return { ok: false, status: 400, error: 'detached HEAD — checkout a branch before push' }
  }

  if (project.kind === 'git' && project.source?.url) {
    const local = validateGitUrl(originUrl.includes('://') ? originUrl : `https://${originUrl}`)
    const expected = validateGitUrl(project.source.url)
    if (local.ok && expected.ok && local.normalizedUrl !== expected.normalizedUrl) {
      return {
        ok: false,
        status: 400,
        error: `origin URL does not match project source (${expected.normalizedUrl})`,
      }
    }
    if (project.source.branch && project.source.branch !== branch) {
      return {
        ok: false,
        status: 400,
        error: `current branch '${branch}' does not match project source branch '${project.source.branch}'`,
      }
    }
  }

  return pushDevTeamArtifacts({
    gitRoot,
    devTeamRel,
    branch,
    message: opts?.message,
    runGit: run,
  })
}

export async function triggerServerSync(opts: {
  serverBaseUrl: string
  projectId: string
  token?: string
}): Promise<{ ok: boolean; error?: string }> {
  const base = opts.serverBaseUrl.replace(/\/$/, '')
  const url = `${base}/api/projects/${encodeURIComponent(opts.projectId)}/sync?project=${encodeURIComponent(opts.projectId)}`
  const headers: Record<string, string> = {}
  const token = opts.token ?? process.env.DEV_TEAM_API_TOKEN?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
    headers['X-Dev-Team-Token'] = token
  }
  const res = await fetch(url, { method: 'POST', headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `server sync failed: ${res.status} ${body}`.slice(0, 500) }
  }
  return { ok: true }
}
