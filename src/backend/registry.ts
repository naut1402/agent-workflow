import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, writeTextFileAtomicSync } from './lib/fileHelper.js'
import { dumpYaml } from './lib/yamlLib.js'
import { DEFAULT_PIPELINE } from '../features/pipeline-editor/business/pipeline/index.js'

const REGISTRY_VERSION = 1

export interface Project {
  id: string
  name: string
  kind: string
  path: string
  addedAt: string
  default: boolean
}

export interface Registry {
  version: number
  projects: Project[]
}

export type ValidateResult =
  | { ok: true; path: string; name: string }
  | { ok: false; status: number; error: string }

export type AddResult =
  | { ok: true; project: Project }
  | { ok: false; status: number; error: string }

export interface RegistryContext {
  registry: {
    list: typeof list
    get: typeof get
    add: typeof add
    remove: typeof remove
    validateProjectPath: typeof validateProjectPath
    seedDefault: typeof seedDefault
  }
  defaultRoot: string | null
  resolveProjectRoot: (projectId: string | null) => string | null
}

/** Config home for the registry: `DEV_TEAM_DASHBOARD_HOME` if set, else `~/.dev-team-dashboard`. */
export function registryHome(): string {
  const override = process.env.DEV_TEAM_DASHBOARD_HOME
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(os.homedir(), '.dev-team-dashboard')
}

export function registryFile(): string {
  return path.join(registryHome(), 'projects.json')
}

/** Store của knowledge scope `global`, dùng chung mọi project, nằm ở registry home. */
export function globalKnowledgeRoot(): string {
  return path.join(registryHome(), 'knowledge')
}

function emptyRegistry(): Registry {
  return { version: REGISTRY_VERSION, projects: [] }
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
    return { version: data.version || REGISTRY_VERSION, projects: data.projects }
  } catch {
    console.warn(`[dev-team-dashboard] projects.json corrupt, treating as empty: ${file}`)
    return emptyRegistry()
  }
}

export function saveRegistry(reg: Registry): Registry {
  const home = registryHome()
  fs.mkdirSync(home, { recursive: true })
  writeTextFileAtomicSync(
    registryFile(),
    JSON.stringify(
      { version: reg.version || REGISTRY_VERSION, projects: reg.projects || [] },
      null,
      2,
    ),
  )
  return reg
}

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

function scaffoldPipelineYaml(projectPath: string): void {
  const dest = path.join(projectPath, 'pipeline.yaml')
  if (existsSync(dest)) return
  try {
    mkdirSync(projectPath, { recursive: true })
    const { version, defaults, steps, doc_reviewer } = DEFAULT_PIPELINE
    writeTextFileAtomicSync(dest, dumpYaml({ version, defaults, steps, doc_reviewer }))
  } catch (err) {
    console.warn(`[dev-team-dashboard] scaffold pipeline.yaml failed for ${projectPath}: ${err}`)
  }
}

/**
 * Validate + canonicalise a user-supplied project path: absolute, an existing directory,
 * either `.dev-team-agent` itself or a project root containing one.
 */
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
  const derivedName = (typeof name === 'string' && name.trim())
    ? name.trim()
    : path.basename(projectRoot) || 'project'

  return { ok: true, path: workspace, name: derivedName }
}

function makeId(name: string, canonicalPath: string): string {
  return `${slug(name)}-${shortHash(canonicalPath)}`
}

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

/** Add a project; idempotent on the canonical path. The first project becomes default. */
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
  scaffoldPipelineYaml(v.path)
  return { ok: true, project }
}

/** Remove a project entry by id (project files are untouched); removing the default promotes the next project. */
export function remove(
  id: string | null | undefined,
): { ok: true; removed: true } | { ok: false; status: number; error: string } {
  if (!id) return { ok: false, status: 400, error: 'id is required' }
  const reg = loadRegistry()
  const idx = reg.projects.findIndex((p) => p.id === id)
  if (idx < 0) return { ok: false, status: 404, error: 'unknown project' }
  const wasDefault = reg.projects[idx].default
  reg.projects.splice(idx, 1)
  if (wasDefault && reg.projects.length) reg.projects[0].default = true
  saveRegistry(reg)
  return { ok: true, removed: true }
}

/** Seed a default project from `devTeamRoot` when the registry is empty; returns the seeded project or null. */
export function seedDefault(devTeamRoot: string | null | undefined): Project | null {
  if (!devTeamRoot) return null
  const reg = loadRegistry()
  if (reg.projects.length) return null
  const res = add({ path: devTeamRoot })
  return res.ok ? res.project : null
}

/**
 * Resolve a projectId to an absolute `.dev-team-agent/` path. Unknown id → null;
 * no id → registry default, then `DEV_TEAM_ROOT`, then `opts.defaultRoot`.
 */
export function resolveProjectRoot(
  projectId: string | null | undefined,
  opts: { defaultRoot?: string | null } = {},
): string | null {
  if (projectId) {
    const project = get(projectId)
    return project ? project.path : null
  }

  const { defaultId, projects } = list()
  if (defaultId) {
    const def = projects.find((p) => p.id === defaultId)
    if (def) return def.path
  }

  const envRoot = process.env.DEV_TEAM_ROOT
  if (envRoot && envRoot.trim()) return path.resolve(envRoot.trim())

  if (opts.defaultRoot) return opts.defaultRoot
  return null
}

/** Build the `ctx` for createApiHandler / MCP; `defaultRoot` is the last fallback of `resolveProjectRoot`. */
export function createRegistryContext(
  { defaultRoot }: { defaultRoot?: string | null } = {},
): RegistryContext {
  return {
    registry: { list, get, add, remove, validateProjectPath, seedDefault },
    defaultRoot: defaultRoot || null,
    resolveProjectRoot: (projectId: string | null) => resolveProjectRoot(projectId, { defaultRoot }),
  }
}
