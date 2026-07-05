// ProjectRegistry — a filesystem-backed store of the dev-team workspaces the
// dashboard can point at. Lives at a neutral, server-global location so it is
// independent of any single `.dev-team-agent/` workspace:
//
//   ~/.dev-team-dashboard/projects.json   (override via DEV_TEAM_DASHBOARD_HOME)
//
// This module is the single source of truth shared by BOTH the REST API
// (server/devTeamApi.js) and the MCP server (mcp/server.mjs), so CRUD applied
// from either channel stays consistent and validation can never be bypassed.
//
// Design ref: U0001 design.md §4.2 (schema + validate), §4.3 (resolveProjectRoot
// + backward-compat).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { validateGitUrl } from '../shared/git/url.js'
import {
  AddApiProjectBodySchema,
  AddSshProjectBodySchema,
  normalizeProject,
  type Project,
} from '../shared/schemas/project.js'
import type { ArtifactFile } from '../shared/schemas/artifact-sync.js'
import { getRunner } from './runners/registry.js'
import { withProjectSyncLock } from './git/syncLock.js'
import {
  pushGitWorkspace as pushGitWorkspaceImpl,
  type PushResult,
} from './git/push.js'
import { ensureDevTeamWorkspace } from './git/scaffold.js'
import {
  cleanupWorkspace,
  cloneShallow,
  pullOrReclone,
  workspaceDir,
} from './git/workspace.js'
import { writeArtifacts } from './workspace/artifactSync.js'

const REGISTRY_VERSION = 1

export type { Project, PushResult }

export interface Registry {
  version: number
  projects: Project[]
}

export type ValidateResult =
  | { ok: true; path: string; name: string }
  | { ok: false; status: number; error: string }

export type ValidateSshResult =
  | {
      ok: true
      path: string
      name: string
      remote: NonNullable<Project['remote']>
    }
  | { ok: false; status: number; error: string }

export type AddResult =
  | { ok: true; project: Project }
  | { ok: false; status: number; error: string }

export interface RegistryContext {
  registry: {
    list: typeof list
    get: typeof get
    add: typeof add
    addFromGit: typeof addFromGit
    syncGitProject: typeof syncGitProject
    pushGitWorkspace: typeof pushGitWorkspace
    addSshProject: typeof addSshProject
    addApiProject: typeof addApiProject
    syncArtifactsProject: typeof syncArtifactsProject
    remove: typeof remove
    validateProjectPath: typeof validateProjectPath
    validateSshProject: typeof validateSshProject
    seedDefault: typeof seedDefault
  }
  defaultRoot: string | null
  resolveProjectRoot: (projectId: string | null) => string | null
}

// ── Locations ─────────────────────────────────────────────────────────────────

// Config home for the registry. Override with DEV_TEAM_DASHBOARD_HOME so the
// store can live somewhere else (tests, multi-instance). Falls back to
// `~/.dev-team-dashboard`.
export function registryHome(): string {
  const override = process.env.DEV_TEAM_DASHBOARD_HOME
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(os.homedir(), '.dev-team-dashboard')
}

export function registryFile(): string {
  return path.join(registryHome(), 'projects.json')
}

// ── Load / save ────────────────────────────────────────────────────────────────

function emptyRegistry(): Registry {
  return { version: REGISTRY_VERSION, projects: [] }
}

// Read the registry. Never throws: a missing or corrupt file is treated as an
// empty registry (mirrors readState's resilience in devTeamApi.js) so the
// server / MCP never crashes on a bad file.
export function loadRegistry(): Registry {
  const file = registryFile()
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return emptyRegistry()
  }
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
      return emptyRegistry()
    }
    const projects = (data.projects as unknown[]).map(normalizeProject)
    return { version: data.version || REGISTRY_VERSION, projects }
  } catch {
    // Corrupt JSON — warn and degrade gracefully instead of crashing.
    console.warn(`[dev-team-dashboard] projects.json corrupt, treating as empty: ${file}`)
    return emptyRegistry()
  }
}

// Persist the registry atomically (write temp + rename), creating the config
// home directory if it does not exist (idempotent).
export function saveRegistry(reg: Registry): Registry {
  const home = registryHome()
  fs.mkdirSync(home, { recursive: true })
  const file = registryFile()
  const tmp = `${file}.tmp`
  const payload = JSON.stringify(
    { version: reg.version || REGISTRY_VERSION, projects: reg.projects || [] },
    null,
    2,
  )
  fs.writeFileSync(tmp, payload, 'utf8')
  fs.renameSync(tmp, file)
  return reg
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function slug(name: unknown): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project'
}

function shortHash(input: unknown): string {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 8)
}

// ── Validation (shared by REST + MCP) ──────────────────────────────────────────

// Validate + canonicalise a user-supplied project path. Returns
//   { ok: true, path: <canonical .dev-team-agent dir>, name: <derived> }
// or { ok: false, status, error } on rejection. See design §4.2.
export function validateProjectPath(input: unknown, name?: unknown): ValidateResult {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, status: 400, error: 'path is required' }
  }
  const raw = input.trim()

  // 1. Must be absolute.
  if (!path.isAbsolute(raw)) {
    return { ok: false, status: 400, error: 'path must be absolute' }
  }

  // 2. Resolve canonical path (guards against symlink escape, .. segments).
  let abs: string
  try {
    abs = fs.realpathSync(path.resolve(raw))
  } catch {
    return { ok: false, status: 400, error: 'path not found' }
  }

  // Must be a directory.
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    return { ok: false, status: 400, error: 'path not found' }
  }
  if (!stat.isDirectory()) {
    return { ok: false, status: 400, error: 'path must be a directory' }
  }

  // 3. Either the path itself IS `.dev-team-agent`, or it contains one
  //    (allow pointing at a project root — we then descend into it).
  let workspace: string
  if (path.basename(abs) === '.dev-team-agent') {
    workspace = abs
  } else {
    const inner = path.join(abs, '.dev-team-agent')
    let innerCanonical: string
    try {
      innerCanonical = fs.realpathSync(inner)
      if (!fs.statSync(innerCanonical).isDirectory()) throw new Error('not dir')
    } catch {
      return { ok: false, status: 400, error: 'not a dev-team-agent workspace' }
    }
    workspace = innerCanonical
  }

  // Derive display name: explicit name wins, else basename of the project root
  // (the directory holding `.dev-team-agent`).
  const projectRoot = path.dirname(workspace)
  const derivedName = (typeof name === 'string' && name.trim())
    ? name.trim()
    : path.basename(projectRoot) || 'project'

  return { ok: true, path: workspace, name: derivedName }
}

function makeId(name: string, canonicalPath: string): string {
  return `${slug(name)}-${shortHash(canonicalPath)}`
}

function defaultArtifactCache(name: string): string {
  return path.join(registryHome(), 'cache', `${slug(name)}-${shortHash(name + Date.now())}`)
}

function scaffoldArtifactCache(cachePath: string): void {
  fs.mkdirSync(path.join(cachePath, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(cachePath, 'tasks'), { recursive: true })
}

function inferNameFromGitUrl(url: string): string {
  const pathname = new URL(url).pathname
  const base = path.basename(pathname)
  return base.replace(/\.git$/i, '') || 'project'
}

function resolveCloneRoot(project: Project): string {
  const byWorkspace = workspaceDir(project.id)
  if (fs.existsSync(byWorkspace)) return byWorkspace
  return path.dirname(project.path)
}

export function validateSshProject(input: unknown, name?: unknown): ValidateSshResult {
  const parsed = AddSshProjectBodySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const body = parsed.data

  const remotePath = body.remotePath.trim()
  if (!remotePath.startsWith('/')) {
    return { ok: false, status: 400, error: 'remotePath must be absolute POSIX path' }
  }

  const runner = getRunner(body.remote.runnerId)
  if (!runner) {
    return { ok: false, status: 404, error: `unknown runner: ${body.remote.runnerId}` }
  }
  if (runner.provider !== 'claude-code-ssh') {
    return { ok: false, status: 400, error: 'runnerId must reference claude-code-ssh provider' }
  }

  const displayName =
    (typeof name === 'string' && name.trim()) ||
    body.name?.trim() ||
    `${body.remote.host}-${slug(remotePath)}`

  let artifactCache = body.remote.artifactCache?.trim()
  if (!artifactCache) {
    artifactCache = defaultArtifactCache(displayName)
  }
  if (!path.isAbsolute(artifactCache)) {
    return { ok: false, status: 400, error: 'artifactCache must be absolute server path' }
  }

  return {
    ok: true,
    path: remotePath,
    name: displayName,
    remote: {
      host: body.remote.host,
      user: body.remote.user,
      port: body.remote.port ?? 22,
      runnerId: body.remote.runnerId,
      artifactCache,
    },
  }
}

export function updateProjectRemoteSync(
  projectId: string,
  patch: { lastSyncedAt?: string; lastSyncError?: string | null },
): void {
  const reg = loadRegistry()
  const idx = reg.projects.findIndex((p) => p.id === projectId)
  if (idx < 0) return
  const project = reg.projects[idx]
  if (!project.remote) return
  if (patch.lastSyncedAt) project.remote.lastSyncedAt = patch.lastSyncedAt
  if (patch.lastSyncError === null) delete project.remote.lastSyncError
  else if (patch.lastSyncError) project.remote.lastSyncError = patch.lastSyncError
  reg.projects[idx] = { ...project }
  saveRegistry(reg)
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

// List all registered projects + the default project id (if any).
export function list(): { projects: Project[]; defaultId: string | null } {
  const reg = loadRegistry()
  const def = reg.projects.find((p) => p.default)
  return { projects: reg.projects, defaultId: def ? def.id : null }
}

// Get one project by id (or null).
export function get(id: string | null | undefined): Project | null {
  if (!id) return null
  const reg = loadRegistry()
  return reg.projects.find((p) => p.id === id) || null
}

// Add a project. Validates + canonicalises the path; idempotent on canonical
// path (returns the existing entry instead of duplicating). Returns
//   { ok: true, project } | { ok: false, status, error }
export function add({ path: inputPath, name }: { path?: string; name?: string } = {}): AddResult {
  const v = validateProjectPath(inputPath, name)
  // `in`-operator narrowing (boolean-discriminant narrowing misbehaves under vue-tsc here).
  if ('error' in v) return v

  const reg = loadRegistry()

  // Idempotent: same canonical path → return existing entry.
  const existing = reg.projects.find((p) => p.path === v.path)
  if (existing) return { ok: true, project: existing }

  const project: Project = {
    id: makeId(v.name, v.path),
    name: v.name,
    kind: 'local',
    path: v.path,
    addedAt: new Date().toISOString(),
    default: reg.projects.length === 0, // first project becomes default
  }
  reg.projects.push(project)
  saveRegistry(reg)
  return { ok: true, project }
}

export async function addFromGit({
  gitUrl,
  branch = 'main',
  name,
  runGit,
}: {
  gitUrl: string
  branch?: string
  name?: string
  runGit?: import('./git/workspace.js').RunGitFn
}): Promise<AddResult> {
  const v = validateGitUrl(gitUrl)
  if (!v.ok) return { ok: false, status: 400, error: 'error' in v ? v.error : 'invalid URL' }

  const reg = loadRegistry()
  const branchResolved = branch?.trim() || 'main'

  const existing = reg.projects.find(
    (p) => p.kind === 'git' && p.source?.url === v.normalizedUrl && p.source.branch === branchResolved,
  )
  if (existing) return { ok: true, project: existing }

  const derivedName = name?.trim() || inferNameFromGitUrl(v.normalizedUrl)
  const provisionalId = makeId(derivedName, `${v.normalizedUrl}#${branchResolved}`)
  const cloneRoot = workspaceDir(provisionalId)

  try {
    await cloneShallow({
      url: v.normalizedUrl,
      branch: branchResolved,
      targetDir: cloneRoot,
      runGit,
    })
    ensureDevTeamWorkspace(cloneRoot)
    const validated = validateProjectPath(cloneRoot, derivedName)
    if ('error' in validated) {
      cleanupWorkspace(cloneRoot)
      return { ok: false, status: 400, error: validated.error }
    }

    const syncedAt = new Date().toISOString()
    const project: Project = {
      id: makeId(validated.name, validated.path),
      name: validated.name,
      kind: 'git',
      path: validated.path,
      addedAt: syncedAt,
      default: reg.projects.length === 0,
      source: {
        type: 'git',
        url: v.normalizedUrl,
        branch: branchResolved,
        lastSyncAt: syncedAt,
      },
    }

    if (project.id !== provisionalId) {
      const finalDir = workspaceDir(project.id)
      fs.mkdirSync(path.dirname(finalDir), { recursive: true })
      fs.renameSync(cloneRoot, finalDir)
      project.path = path.join(finalDir, '.dev-team-agent')
    }

    reg.projects.push(project)
    saveRegistry(reg)
    return { ok: true, project }
  } catch (e) {
    cleanupWorkspace(cloneRoot)
    const msg = String((e as Error)?.message || e)
    return {
      ok: false,
      status: 400,
      error: msg.includes('branch')
        ? `git clone failed (branch '${branchResolved}'?): ${msg}`
        : `git clone failed: ${msg}`,
    }
  }
}

export async function syncGitProject(
  id: string,
  runGit?: import('./git/workspace.js').RunGitFn,
): Promise<AddResult & { syncedAt?: string }> {
  return withProjectSyncLock(id, async () => {
    const project = get(id)
    if (!project) return { ok: false, status: 404, error: 'unknown project' }
    if (project.kind !== 'git' || !project.source) {
      return { ok: false, status: 400, error: 'not a git project' }
    }

    const cloneRoot = resolveCloneRoot(project)

    try {
      await pullOrReclone({
        cloneRoot,
        url: project.source.url,
        branch: project.source.branch,
        runGit,
      })
      ensureDevTeamWorkspace(cloneRoot)
      const revalidated = validateProjectPath(cloneRoot)
      if ('error' in revalidated) {
        return { ok: false, status: 500, error: 'workspace invalid after sync' }
      }

      const reg = loadRegistry()
      const idx = reg.projects.findIndex((p) => p.id === id)
      const syncedAt = new Date().toISOString()
      reg.projects[idx] = {
        ...reg.projects[idx],
        path: revalidated.path,
        source: { ...project.source, lastSyncAt: syncedAt },
      }
      saveRegistry(reg)
      return { ok: true, project: reg.projects[idx], syncedAt }
    } catch (e) {
      return { ok: false, status: 500, error: `sync failed: ${e}` }
    }
  })
}

export async function pushGitWorkspace(
  id: string,
  opts?: { message?: string; runGit?: import('./git/workspace.js').RunGitFn },
): Promise<PushResult> {
  const project = get(id)
  if (!project) return { ok: false, status: 404, error: 'unknown project' }
  return pushGitWorkspaceImpl(project, opts)
}

export function addSshProject(body: unknown): AddResult {
  const v = validateSshProject(body)
  if ('error' in v) return v

  const reg = loadRegistry()

  const existing = reg.projects.find(
    (p) =>
      p.kind === 'ssh' &&
      p.path === v.path &&
      p.remote?.host === v.remote.host &&
      p.remote?.user === v.remote.user,
  )
  if (existing) return { ok: true, project: existing }

  const existingCache = reg.projects.find((p) => p.remote?.artifactCache === v.remote.artifactCache)
  if (existingCache) return { ok: true, project: existingCache }

  try {
    fs.mkdirSync(v.remote.artifactCache, { recursive: true })
    scaffoldArtifactCache(v.remote.artifactCache)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 400, error: `cannot create artifact cache: ${message}` }
  }

  const project: Project = {
    id: makeId(v.name, v.path),
    name: v.name,
    kind: 'ssh',
    path: v.path,
    remote: v.remote,
    addedAt: new Date().toISOString(),
    default: reg.projects.length === 0,
  }
  reg.projects.push(project)
  saveRegistry(reg)
  return { ok: true, project }
}

export function addApiProject(body: unknown): AddResult {
  const parsed = AddApiProjectBodySchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const b = parsed.data
  const reg = loadRegistry()

  if (b.sourceUrl) {
    const branchResolved = b.branch?.trim() || 'main'
    const existing = reg.projects.find(
      (p) => p.kind === 'api' && p.source?.url === b.sourceUrl && p.source.branch === branchResolved,
    )
    if (existing) return { ok: true, project: existing } // idempotent, giống addFromGit
  }

  const displayName = b.name?.trim() || (b.sourceUrl ? inferNameFromGitUrl(b.sourceUrl) : 'project')
  const cachePath = defaultArtifactCache(displayName)
  try {
    fs.mkdirSync(cachePath, { recursive: true })
    scaffoldArtifactCache(cachePath)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 400, error: `cannot create artifact cache: ${message}` }
  }

  const project: Project = {
    id: makeId(displayName, cachePath),
    name: displayName,
    kind: 'api',
    path: cachePath,
    addedAt: new Date().toISOString(),
    default: reg.projects.length === 0,
    source: b.sourceUrl ? { type: 'git', url: b.sourceUrl, branch: b.branch?.trim() || 'main' } : undefined,
  }
  reg.projects.push(project)
  saveRegistry(reg)
  return { ok: true, project }
}

export function updateProjectApiSync(
  projectId: string,
  patch: { lastSyncedAt?: string; lastSyncError?: string | null },
): void {
  const reg = loadRegistry()
  const idx = reg.projects.findIndex((p) => p.id === projectId)
  if (idx < 0) return
  const project = reg.projects[idx]
  const apiSync = { ...(project.apiSync || {}) }
  if (patch.lastSyncedAt) apiSync.lastSyncedAt = patch.lastSyncedAt
  if (patch.lastSyncError === null) delete apiSync.lastSyncError
  else if (patch.lastSyncError) apiSync.lastSyncError = patch.lastSyncError
  reg.projects[idx] = { ...project, apiSync }
  saveRegistry(reg)
}

export async function syncArtifactsProject(
  id: string,
  files: ArtifactFile[],
): Promise<AddResult & { syncedAt?: string; filesWritten?: number; filesDeleted?: number }> {
  return withProjectSyncLock(id, async () => {
    const project = get(id)
    if (!project) return { ok: false, status: 404, error: 'unknown project' }
    if (project.kind !== 'api') {
      return { ok: false, status: 400, error: 'project is not api-kind' }
    }

    const result = await writeArtifacts({ projectRoot: project.path, files })
    // `in`-operator narrowing (boolean-discriminant narrowing misbehaves under vue-tsc here).
    if ('error' in result) {
      updateProjectApiSync(id, { lastSyncError: result.error })
      return result
    }

    const syncedAt = new Date().toISOString()
    updateProjectApiSync(id, { lastSyncedAt: syncedAt, lastSyncError: null })
    return {
      ok: true,
      project: get(id)!,
      syncedAt,
      filesWritten: result.filesWritten,
      filesDeleted: result.filesDeleted,
    }
  })
}

// Remove a project from the registry by id. Does NOT touch the project's
// filesystem — only the registry entry. Refuses to remove the default entry
// (a default must remain for backward-compat). Returns
//   { ok: true, removed: true } | { ok: false, status, error }
export function remove(
  id: string | null | undefined,
): { ok: true; removed: true } | { ok: false; status: number; error: string } {
  if (!id) return { ok: false, status: 400, error: 'id is required' }
  const reg = loadRegistry()
  const idx = reg.projects.findIndex((p) => p.id === id)
  if (idx < 0) return { ok: false, status: 404, error: 'unknown project' }
  if (reg.projects[idx].default) {
    return { ok: false, status: 400, error: 'cannot remove the default project' }
  }
  reg.projects.splice(idx, 1)
  saveRegistry(reg)
  return { ok: true, removed: true }
}

// Seed a default project from an explicit `.dev-team-agent` root (e.g.
// DEV_TEAM_ROOT) when the registry is empty. Idempotent: does nothing if any
// project is already registered. Returns the seeded project or null.
export function seedDefault(devTeamRoot: string | null | undefined): Project | null {
  if (!devTeamRoot) return null
  const reg = loadRegistry()
  if (reg.projects.length) return null
  const res = add({ path: devTeamRoot })
  return res.ok ? res.project : null
}

// ── Root resolution (backward-compat) ───────────────────────────────────────────

// Resolve a projectId to an absolute `.dev-team-agent/` path.
//   - explicit, known id → that project's path
//   - explicit, unknown id → null (caller returns 404)
//   - null/empty id → the DEFAULT project:
//       1. DEV_TEAM_ROOT env (if set)              ← highest priority
//       2. registry entry with default: true
//       3. opts.defaultRoot (e.g. Vite cwd/..)     ← legacy fallback
// Design §4.3.
export function resolveProjectRoot(
  projectId: string | null | undefined,
  opts: { defaultRoot?: string | null } = {},
): string | null {
  if (projectId) {
    const project = get(projectId)
    if (!project) return null
    if (project.kind === 'ssh') {
      return project.remote?.artifactCache ?? null
    }
    return project.path
  }

  // No project → default.
  const envRoot = process.env.DEV_TEAM_ROOT
  if (envRoot && envRoot.trim()) return path.resolve(envRoot.trim())

  const { defaultId, projects } = list()
  if (defaultId) {
    const def = projects.find((p) => p.id === defaultId)
    if (def) {
      if (def.kind === 'ssh') return def.remote?.artifactCache ?? null
      return def.path
    }
  }

  if (opts.defaultRoot) return opts.defaultRoot
  return null
}

// Build a `ctx` object for createApiHandler / MCP. `defaultRoot` is the legacy
// fallback used when no project is selected and neither DEV_TEAM_ROOT nor a
// registry default exists (preserves the old Vite `cwd/..` behaviour).
export function createRegistryContext(
  { defaultRoot }: { defaultRoot?: string | null } = {},
): RegistryContext {
  return {
    registry: {
      list,
      get,
      add,
      addFromGit,
      syncGitProject,
      pushGitWorkspace,
      addSshProject,
      addApiProject,
      syncArtifactsProject,
      remove,
      validateProjectPath,
      validateSshProject,
      seedDefault,
    },
    defaultRoot: defaultRoot || null,
    resolveProjectRoot: (projectId: string | null) => resolveProjectRoot(projectId, { defaultRoot }),
  }
}
