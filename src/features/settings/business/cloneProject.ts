/**
 * Clone a git repo into dashboard workspace and register as a project.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { registryHome, add, loadRegistry, saveRegistry, get, type Project } from '../../../core/registry.js'
import { emit } from '../../../core/events/index.js'

function sanitiseBranch(branch: unknown): string | null {
  if (typeof branch !== 'string' || !branch.trim()) return null
  const b = branch.trim()
  if (!/^[A-Za-z0-9._/-]+$/.test(b) || b.includes('..')) return null
  return b.slice(0, 200)
}

function sanitiseGitUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null
  const u = url.trim()
  if (/^https:\/\/[^\s]+$/i.test(u)) return u.slice(0, 500)
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
  if (!gitUrl) return { ok: false, status: 400, error: 'invalid gitUrl (https or git@ only)' }
  const branch = sanitiseBranch(input.branch) || 'main'

  const clonesRoot = path.join(registryHome(), 'clones')
  fs.mkdirSync(clonesRoot, { recursive: true })
  const destBase =
    (typeof input.destName === 'string' && /^[A-Za-z0-9_-]+$/.test(input.destName)
      ? input.destName
      : `repo-${Date.now().toString(36)}`).slice(0, 64)
  const dest = path.join(clonesRoot, destBase)
  if (fs.existsSync(dest)) {
    return { ok: false, status: 409, error: 'clone destination already exists' }
  }

  const result = spawnSync(
    'git',
    ['clone', '--branch', branch, '--single-branch', '--depth', '1', gitUrl, dest],
    { encoding: 'utf8', windowsHide: true, timeout: 300_000 },
  )
  if (result.status !== 0) {
    try {
      fs.rmSync(dest, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    const err = [result.stderr, result.stdout].filter(Boolean).join('\n').trim() || `git clone exit ${result.status}`
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
    name: input.name || path.basename(dest),
  })
  if ('error' in added) {
    return { ok: false, status: added.status || 400, error: added.error }
  }

  const reg = loadRegistry()
  const proj = reg.projects.find((p) => p.id === added.project.id)
  if (proj) {
    proj.kind = 'git'
    proj.gitUrl = gitUrl
    proj.defaultBranch = branch
    proj.branch = branch
    proj.repoPath = dest
    saveRegistry(reg)
  }

  emit('task.created', { kind: 'project.cloned', projectId: added.project.id, gitUrl, branch })
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
  const hit = reg.projects.find((p) => p.id === projectId)
  if (!hit) return { ok: false, status: 404, error: 'unknown project' }
  hit.branch = b
  saveRegistry(reg)
  return { ok: true, project: hit, branch: b }
}
