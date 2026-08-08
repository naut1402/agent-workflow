/**
 * Clone a git repo into dashboard workspace and register as a project.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { registryHome, add, loadRegistry, saveRegistry, get, type Project } from '../../../../core/registry.js'
import {
  loadGithubTokensConfig,
  parseGithubRepoRef,
  resolveGithubTokenForRepo,
} from '../../../settings/business/index.js'

/** Git metadata kept on registry JSON without extending core Project. */
type ProjectGitMeta = Project & {
  gitUrl?: string
  defaultBranch?: string
  branch?: string
  repoPath?: string
}

function sanitiseBranch(branch: unknown): string | null {
  if (typeof branch !== 'string' || !branch.trim()) return null
  const b = branch.trim()
  if (!/^[A-Za-z0-9._/-]+$/.test(b) || b.includes('..')) return null
  return b.slice(0, 200)
}

function sanitiseGitUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null
  const u = url.trim()
  // https://host/owner/repo[.git][/...]
  if (/^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+/i.test(u)) return u.slice(0, 500)
  // git@host:owner/repo.git
  if (/^git@[\w.-]+:[\w./-]+\.git$/i.test(u)) return u.slice(0, 500)
  return null
}

function ensureDevTeamAgent(repoDir: string): string {
  const inner = path.join(repoDir, '.dev-team-agent')
  if (!fs.existsSync(inner)) {
    fs.mkdirSync(inner, { recursive: true })
    fs.mkdirSync(path.join(inner, 'tasks'), { recursive: true })
    fs.mkdirSync(path.join(inner, '.dev-state'), { recursive: true })
  }
  return fs.realpathSync(inner)
}

/** Prefer real git.exe on Windows when PATH is incomplete (IDE-launched servers). */
function resolveGitCommand(): string {
  if (process.platform !== 'win32') return 'git'
  const candidates = [
    process.env.GIT_EXEC_PATH && path.join(process.env.GIT_EXEC_PATH, 'git.exe'),
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return 'git'
}

function runGit(args: string[]): SpawnSyncReturns<string> {
  const opts = {
    encoding: 'utf8' as const,
    windowsHide: true,
    timeout: 300_000,
    env: process.env,
  }
  const git = resolveGitCommand()
  let result = spawnSync(git, args, opts)
  // Fallback: shell resolves `.cmd` shims when direct spawn misses PATH.
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    result = spawnSync('git', args, { ...opts, shell: true })
  }
  return result
}

function formatGitFailure(result: SpawnSyncReturns<string>): string {
  const spawnErr = result.error as NodeJS.ErrnoException | undefined
  if (spawnErr?.code === 'ENOENT') {
    return 'Không tìm thấy git trên PATH. Cài Git for Windows hoặc mở terminal có git rồi chạy lại dashboard.'
  }
  if (spawnErr) return `git spawn failed: ${spawnErr.message}`
  if (result.signal) return `git clone killed (${result.signal})`
  const out = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
  if (out) return out
  return `git clone thất bại (exit ${result.status ?? 'unknown'})`
}

/** Last path segment of URL / SSH ref, without `.git`. */
function deriveRepoName(gitUrl: string): string {
  const slug = parseGithubRepoRef(gitUrl)
  if (slug) {
    const repo = slug.split('/')[1] || 'repo'
    return repo.replace(/\.git$/i, '') || 'repo'
  }
  const tail = gitUrl
    .replace(/\/+$/, '')
    .split(/[/:]/)
    .filter(Boolean)
    .pop() || 'repo'
  return tail.replace(/\.git$/i, '') || 'repo'
}

function sanitiseDestSegment(raw: string): string {
  return (
    raw
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'repo'
  )
}

/**
 * Folder under clones/: prefer `repo-branch`; if exists append base36 timestamp
 * so same repo + other branch (or re-clone) still works.
 */
function allocateCloneDest(
  clonesRoot: string,
  opts: { destName?: string; repoName: string; branch: string },
): string {
  if (typeof opts.destName === 'string' && /^[A-Za-z0-9_-]+$/.test(opts.destName)) {
    return path.join(clonesRoot, opts.destName.slice(0, 64))
  }
  const base = sanitiseDestSegment(`${opts.repoName}-${opts.branch}`)
  const primary = path.join(clonesRoot, base)
  if (!fs.existsSync(primary)) return primary
  return path.join(clonesRoot, `${base}-${Date.now().toString(36)}`.slice(0, 64))
}

/**
 * Canonical HTTPS clone URL from already-parsed owner/repo.
 * Exported for unit tests — do not re-match the path with a non-anchored
 * non-greedy regex (that truncated `agent-workflow` → `a`).
 */
export function normaliseGithubCloneUrl(gitUrl: string, owner: string, repo: string): string {
  if (/^git@github\.com:/i.test(gitUrl) || /^https:\/\/github\.com\//i.test(gitUrl)) {
    return `https://github.com/${owner}/${repo}.git`
  }
  return gitUrl
}

/** Map clone URL → PAT from Settings / GITHUB_TOKEN (GitHub HTTPS only). */
function resolveCloneAuth(gitUrl: string): {
  cloneUrl: string
  extraHeader: string | null
  usedToken: boolean
} {
  const slug = parseGithubRepoRef(gitUrl)
  if (!slug) return { cloneUrl: gitUrl, extraHeader: null, usedToken: false }
  const [owner, repo] = slug.split('/')
  const token = resolveGithubTokenForRepo(
    loadGithubTokensConfig(),
    owner,
    repo,
    process.env.GITHUB_TOKEN,
  )
  if (!token) return { cloneUrl: gitUrl, extraHeader: null, usedToken: false }

  // Prefer HTTPS + Bearer header so token never lands in remote URL / .git/config.
  const cloneUrl = normaliseGithubCloneUrl(gitUrl, owner, repo)

  const safeToken = token.replace(/[\r\n]/g, '').split(String.fromCharCode(0)).join('').trim()
  return {
    cloneUrl,
    extraHeader: `Authorization: Bearer ${safeToken}`,
    usedToken: true,
  }
}

export type CloneResult =
  | { ok: true; project: Project; repoPath: string; branch: string }
  | { ok: false; status: number; error: string }

/**
 * `git clone --branch <branch> --single-branch <url> <dest>` then register
 * the `.dev-team-agent` path (created if missing).
 */
export function cloneProject(input: {
  gitUrl: string
  branch?: string
  name?: string
  destName?: string
}): CloneResult {
  const gitUrl = sanitiseGitUrl(input.gitUrl)
  if (!gitUrl) {
    return {
      ok: false,
      status: 400,
      error: 'URL không hợp lệ — dùng https://host/owner/repo hoặc git@host:owner/repo.git',
    }
  }
  const branch = sanitiseBranch(input.branch) || 'main'
  const auth = resolveCloneAuth(gitUrl)
  const repoName = deriveRepoName(gitUrl)
  const displayName =
    (typeof input.name === 'string' && input.name.trim()) || repoName

  const clonesRoot = path.join(registryHome(), 'clones')
  fs.mkdirSync(clonesRoot, { recursive: true })
  const dest = allocateCloneDest(clonesRoot, {
    destName: input.destName,
    repoName,
    branch,
  })
  if (fs.existsSync(dest)) {
    return { ok: false, status: 409, error: 'clone destination already exists' }
  }

  const gitArgs = [
    ...(auth.extraHeader ? ['-c', `http.extraHeader=${auth.extraHeader}`] : []),
    'clone',
    '--branch',
    branch,
    '--single-branch',
    '--depth',
    '1',
    auth.cloneUrl,
    dest,
  ]
  const result = runGit(gitArgs)
  if (result.status !== 0) {
    try {
      fs.rmSync(dest, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    let err = formatGitFailure(result)
    if (/Authentication failed|could not read Username|403|401|Permission denied/i.test(err)) {
      err += auth.usedToken
        ? ' (đã dùng token Settings — kiểm tra quyền repo / PAT).'
        : ' (repo private? Thêm PAT trong Settings → Projects → Token GitHub).'
    }
    return { ok: false, status: 400, error: err.slice(0, 500) }
  }

  let workspace: string
  try {
    workspace = ensureDevTeamAgent(dest)
  } catch (e: any) {
    return { ok: false, status: 500, error: String(e.message || e) }
  }

  const added = add({
    path: workspace,
    name: displayName,
  })
  if ('error' in added) {
    return { ok: false, status: added.status || 400, error: added.error }
  }

  const reg = loadRegistry()
  const proj = reg.projects.find((p) => p.id === added.project.id) as ProjectGitMeta | undefined
  if (proj) {
    proj.kind = 'git'
    proj.gitUrl = gitUrl
    proj.defaultBranch = branch
    proj.branch = branch
    proj.repoPath = dest
    saveRegistry(reg)
  }

  return { ok: true, project: proj || added.project, repoPath: dest, branch }
}

/** Update branch field on an existing project (metadata only — does not checkout). */
export function setProjectBranch(
  projectId: string,
  branch: string,
): { ok: true; project: Project; branch: string } | { ok: false; status: number; error: string } {
  const b = sanitiseBranch(branch)
  if (!b) return { ok: false, status: 400, error: 'invalid branch' }
  const proj = get(projectId)
  if (!proj) return { ok: false, status: 404, error: 'unknown project' }
  const reg = loadRegistry()
  const hit = reg.projects.find((p) => p.id === projectId) as ProjectGitMeta | undefined
  if (!hit) return { ok: false, status: 404, error: 'unknown project' }
  hit.branch = b
  saveRegistry(reg)
  return { ok: true, project: hit, branch: b }
}
