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
import { AddSshProjectBodySchema, ProjectLegacySchema } from '../shared/schemas/project.js'
import { getRunner } from './runners/registry.js'

const REGISTRY_VERSION = 1

export interface ProjectRemote {
  host: string
  user: string
  port?: number
  runnerId: string
  artifactCache: string
  lastSyncedAt?: string
  lastSyncError?: string
}

export interface Project {
  id: string
  name: string
  kind: 'local' | 'ssh'
  path: string
  addedAt: string
  default: boolean
  remote?: ProjectRemote
}

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
      remote: ProjectRemote
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
    addSshProject: typeof addSshProject
    remove: typeof remove
    validateProjectPath: typeof validateProjectPath
    validateSshProject: typeof validateSshProject
    seedDefault: typeof seedDefault
  }
  defaultRoot: string | null
  resolveProjectRoot: (projectId: string | null) => string | null
}

// ── Locations ─────────────────────────────────────────────────────────────────

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

function parseProjectEntry(raw: unknown): Project | null {
  const parsed = ProjectLegacySchema.safeParse(raw)
  if (!parsed.success) {
    console.warn('[dev-team-dashboard] skipping invalid project entry:', parsed.error.message)
    return null
  }
  return parsed.data as Project
}

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
    const projects = data.projects.map(parseProjectEntry).filter((p): p is Project => Boolean(p))
    return { version: data.version || REGISTRY_VERSION, projects }
  } catch {
    console.warn(`[dev-team-dashboard] projects.json corrupt, treating as empty: ${file}`)
    return emptyRegistry()
  }
}

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
  return (
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  )
}

function shortHash(input: unknown): string {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 8)
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

// ── Validation (shared by REST + MCP) ──────────────────────────────────────────

export function validateProjectPath(input: unknown, name?: unknown): ValidateResult {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, status: 400, error: 'path is required' }
  }
  const raw = input.trim()

  if (!path.isAbsolute(raw)) {
    return { ok: false, status: 400, error: 'path must be absolute' }
  }

  let abs: string
  try {
    abs = fs.realpathSync(path.resolve(raw))
  } catch {
    return { ok: false, status: 400, error: 'path not found' }
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    return { ok: false, status: 400, error: 'path not found' }
  }
  if (!stat.isDirectory()) {
    return { ok: false, status: 400, error: 'path must be a directory' }
  }

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

  const projectRoot = path.dirname(workspace)
  const derivedName =
    typeof name === 'string' && name.trim() ? name.trim() : path.basename(projectRoot) || 'project'

  return { ok: true, path: workspace, name: derivedName }
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

export function list(): { projects: Project[]; defaultId: string | null } {
  const reg = loadRegistry()
  const def = reg.projects.find((p) => p.default)
  return { projects: reg.projects, defaultId: def ? def.id : null }
}

export function get(id: string | null | undefined): Project | null {
  if (!id) return null
  const reg = loadRegistry()
  return reg.projects.find((p) => p.id === id) || null
}

export function add({ path: inputPath, name }: { path?: string; name?: string } = {}): AddResult {
  const v = validateProjectPath(inputPath, name)
  if ('error' in v) return v

  const reg = loadRegistry()

  const existing = reg.projects.find((p) => p.path === v.path)
  if (existing) return { ok: true, project: existing }

  const project: Project = {
    id: makeId(v.name, v.path),
    name: v.name,
    kind: 'local',
    path: v.path,
    addedAt: new Date().toISOString(),
    default: reg.projects.length === 0,
  }
  reg.projects.push(project)
  saveRegistry(reg)
  return { ok: true, project }
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

export function seedDefault(devTeamRoot: string | null | undefined): Project | null {
  if (!devTeamRoot) return null
  const reg = loadRegistry()
  if (reg.projects.length) return null
  const res = add({ path: devTeamRoot })
  return res.ok ? res.project : null
}

// ── Root resolution (backward-compat) ───────────────────────────────────────────

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

export function createRegistryContext(
  { defaultRoot }: { defaultRoot?: string | null } = {},
): RegistryContext {
  return {
    registry: {
      list,
      get,
      add,
      addSshProject,
      remove,
      validateProjectPath,
      validateSshProject,
      seedDefault,
    },
    defaultRoot: defaultRoot || null,
    resolveProjectRoot: (projectId: string | null) => resolveProjectRoot(projectId, { defaultRoot }),
  }
}
