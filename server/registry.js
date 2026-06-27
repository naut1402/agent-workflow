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

const REGISTRY_VERSION = 1

// ── Locations ─────────────────────────────────────────────────────────────────

// Config home for the registry. Override with DEV_TEAM_DASHBOARD_HOME so the
// store can live somewhere else (tests, multi-instance). Falls back to
// `~/.dev-team-dashboard`.
export function registryHome() {
  const override = process.env.DEV_TEAM_DASHBOARD_HOME
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(os.homedir(), '.dev-team-dashboard')
}

export function registryFile() {
  return path.join(registryHome(), 'projects.json')
}

// ── Load / save ────────────────────────────────────────────────────────────────

function emptyRegistry() {
  return { version: REGISTRY_VERSION, projects: [] }
}

// Read the registry. Never throws: a missing or corrupt file is treated as an
// empty registry (mirrors readState's resilience in devTeamApi.js) so the
// server / MCP never crashes on a bad file.
export function loadRegistry() {
  const file = registryFile()
  let raw
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
    // Corrupt JSON — warn and degrade gracefully instead of crashing.
    // eslint-disable-next-line no-console
    console.warn(`[dev-team-dashboard] projects.json corrupt, treating as empty: ${file}`)
    return emptyRegistry()
  }
}

// Persist the registry atomically (write temp + rename), creating the config
// home directory if it does not exist (idempotent).
export function saveRegistry(reg) {
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

function slug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project'
}

function shortHash(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 8)
}

// ── Validation (shared by REST + MCP) ──────────────────────────────────────────

// Validate + canonicalise a user-supplied project path. Returns
//   { ok: true, path: <canonical .dev-team-agent dir>, name: <derived> }
// or { ok: false, status, error } on rejection. See design §4.2.
export function validateProjectPath(input, name) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, status: 400, error: 'path is required' }
  }
  const raw = input.trim()

  // 1. Must be absolute.
  if (!path.isAbsolute(raw)) {
    return { ok: false, status: 400, error: 'path must be absolute' }
  }

  // 2. Resolve canonical path (guards against symlink escape, .. segments).
  let abs
  try {
    abs = fs.realpathSync(path.resolve(raw))
  } catch {
    return { ok: false, status: 400, error: 'path not found' }
  }

  // Must be a directory.
  let stat
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
  let workspace
  if (path.basename(abs) === '.dev-team-agent') {
    workspace = abs
  } else {
    const inner = path.join(abs, '.dev-team-agent')
    let innerCanonical
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

function makeId(name, canonicalPath) {
  return `${slug(name)}-${shortHash(canonicalPath)}`
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

// List all registered projects + the default project id (if any).
export function list() {
  const reg = loadRegistry()
  const def = reg.projects.find((p) => p.default)
  return { projects: reg.projects, defaultId: def ? def.id : null }
}

// Get one project by id (or null).
export function get(id) {
  if (!id) return null
  const reg = loadRegistry()
  return reg.projects.find((p) => p.id === id) || null
}

// Add a project. Validates + canonicalises the path; idempotent on canonical
// path (returns the existing entry instead of duplicating). Returns
//   { ok: true, project } | { ok: false, status, error }
export function add({ path: inputPath, name } = {}) {
  const v = validateProjectPath(inputPath, name)
  if (!v.ok) return v

  const reg = loadRegistry()

  // Idempotent: same canonical path → return existing entry.
  const existing = reg.projects.find((p) => p.path === v.path)
  if (existing) return { ok: true, project: existing }

  const project = {
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

// Remove a project from the registry by id. Does NOT touch the project's
// filesystem — only the registry entry. Refuses to remove the default entry
// (a default must remain for backward-compat). Returns
//   { ok: true, removed: true } | { ok: false, status, error }
export function remove(id) {
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
export function seedDefault(devTeamRoot) {
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
export function resolveProjectRoot(projectId, opts = {}) {
  if (projectId) {
    const project = get(projectId)
    return project ? project.path : null
  }

  // No project → default.
  const envRoot = process.env.DEV_TEAM_ROOT
  if (envRoot && envRoot.trim()) return path.resolve(envRoot.trim())

  const { defaultId, projects } = list()
  if (defaultId) {
    const def = projects.find((p) => p.id === defaultId)
    if (def) return def.path
  }

  if (opts.defaultRoot) return opts.defaultRoot
  return null
}

// Build a `ctx` object for createApiHandler / MCP. `defaultRoot` is the legacy
// fallback used when no project is selected and neither DEV_TEAM_ROOT nor a
// registry default exists (preserves the old Vite `cwd/..` behaviour).
export function createRegistryContext({ defaultRoot } = {}) {
  return {
    registry: { list, get, add, remove, validateProjectPath, seedDefault },
    defaultRoot: defaultRoot || null,
    resolveProjectRoot: (projectId) => resolveProjectRoot(projectId, { defaultRoot }),
  }
}
