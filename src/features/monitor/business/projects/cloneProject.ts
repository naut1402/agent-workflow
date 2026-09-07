/**
 * Clone a git repo into dashboard workspace and register as a project.
 */

import fs from 'node:fs'
import path from 'node:path'
import { formatGitFailure, runGit, GIT_CLONE_TIMEOUT_MS } from '../git.js'
import { registryHome, add, loadRegistry, saveRegistry, get, type Project } from '../../../../core/registry.js'
import { isPrivateHostname } from '../../../agent-editor/business/index.js'
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

/** Reject private/loopback hosts (same policy spirit as fetchUrlSafe). Exported for tests. */
export function sanitiseGitUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null
  const u = url.trim().slice(0, 500)
  // https://host/owner/repo — no userinfo (@); blocks SSRF to private hosts.
  if (/^https:\/\/[^\s/@]+\/[^\s/]+\/[^\s/]+/i.test(u)) {
    try {
      const host = new URL(u).hostname
      if (!host || isPrivateHostname(host)) return null
      return u
    } catch {
      return null
    }
  }
  // git@host:owner/repo.git
  const ssh = u.match(/^git@([\w.-]+):[\w./-]+\.git$/i)
  if (ssh) {
    if (isPrivateHostname(ssh[1])) return null
    return u
  }
  return null
}

/** True only for github.com HTTPS or SSH remotes (PAT must never leave GitHub). */
export function isGithubGitRemote(gitUrl: string): boolean {
  return /^https:\/\/(?:www\.)?github\.com\//i.test(gitUrl) || /^git@github\.com:/i.test(gitUrl)
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

/**
 * GitHub git Smart HTTP rejects `Authorization: Bearer` (`remote: invalid credentials`).
 * Use Basic with username `x-access-token` (token stays out of the remote URL).
 * Exported for unit tests.
 */
export function githubGitAuthExtraHeader(token: string): string {
  const safeToken = token.replace(/[\r\n]/g, '').split(String.fromCharCode(0)).join('').trim()
  const basic = Buffer.from(`x-access-token:${safeToken}`, 'utf8').toString('base64')
  return `Authorization: Basic ${basic}`
}

/** Map clone URL → PAT from Settings / GITHUB_TOKEN (GitHub remotes only). */
export function resolveCloneAuth(gitUrl: string): {
  cloneUrl: string
  extraHeader: string | null
  usedToken: boolean
} {
  // Defense in depth: never send PAT to a non-github host even if slug parse matches.
  if (!isGithubGitRemote(gitUrl)) {
    return { cloneUrl: gitUrl, extraHeader: null, usedToken: false }
  }
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

  const cloneUrl = normaliseGithubCloneUrl(gitUrl, owner, repo)
  return {
    cloneUrl,
    extraHeader: githubGitAuthExtraHeader(token),
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
  const result = runGit(gitArgs, { timeout: GIT_CLONE_TIMEOUT_MS })
  if (result.status !== 0) {
    try {
      fs.rmSync(dest, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    let err = formatGitFailure(result, 'git clone')
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
  if (!proj) {
    return { ok: false, status: 500, error: 'project registered but not found in registry' }
  }
  proj.kind = 'git'
  proj.gitUrl = gitUrl
  proj.defaultBranch = branch
  proj.branch = branch
  proj.repoPath = dest
  saveRegistry(reg)

  return { ok: true, project: proj, repoPath: dest, branch }
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
