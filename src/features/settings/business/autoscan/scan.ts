// Scan whitelist directories for project roots that contain `.dev-team-agent`
// and register them via ProjectRegistry.add (idempotent on canonical path).

import fs from 'node:fs'
import path from 'node:path'
import { safeReadDir } from '../../../../core/lib/fileHelper.js'
import { add, list, type Project } from '../../../../core/registry.js'

export interface ScanHit {
  path: string
  project: Project | null
  status: 'added' | 'existing' | 'error'
  error?: string
}

export interface ScanReport {
  scanned: number
  added: Project[]
  existing: Project[]
  skipped: { path: string; reason: string }[]
  errors: { path: string; error: string }[]
  hits: ScanHit[]
}

function hasDevTeamAgent(dir: string): boolean {
  try {
    const inner = path.join(dir, '.dev-team-agent')
    return fs.statSync(inner).isDirectory()
  } catch {
    return false
  }
}

function isDevTeamAgentDir(dir: string): boolean {
  return path.basename(dir) === '.dev-team-agent'
}

/** Collect candidate project roots under one whitelist entry (depth 1). */
async function collectCandidates(root: string): Promise<string[]> {
  let abs: string
  try {
    abs = fs.realpathSync(path.resolve(root))
  } catch {
    return []
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    return []
  }
  if (!stat.isDirectory()) return []

  const found: string[] = []

  if (isDevTeamAgentDir(abs) || hasDevTeamAgent(abs)) {
    found.push(abs)
  }

  for (const d of await safeReadDir(abs)) {
    if (!d.isDirectory()) continue
    if (d.name === '.dev-team-agent') continue
    const child = path.join(abs, d.name)
    if (hasDevTeamAgent(child)) found.push(child)
  }

  return found
}

/**
 * Scan whitelist paths and register any `.dev-team-agent` workspaces found.
 * Depth: whitelist entry itself + one level of children.
 */
export async function runAutoscan(
  whitelist: string[],
  deps: { add?: typeof add; list?: typeof list } = {},
): Promise<ScanReport> {
  const addFn = deps.add ?? add
  const listFn = deps.list ?? list

  const report: ScanReport = {
    scanned: 0,
    added: [],
    existing: [],
    skipped: [],
    errors: [],
    hits: [],
  }

  const knownPaths = new Set(listFn().projects.map((p) => p.path))

  const candidates = new Set<string>()
  for (const entry of whitelist) {
    const trimmed = String(entry || '').trim()
    if (!trimmed) continue
    if (!path.isAbsolute(trimmed)) {
      report.skipped.push({ path: trimmed, reason: 'path must be absolute' })
      continue
    }
    let found: string[]
    try {
      found = await collectCandidates(trimmed)
    } catch (e) {
      report.errors.push({ path: trimmed, error: String((e as Error)?.message ?? e) })
      continue
    }
    if (!found.length) {
      report.skipped.push({ path: trimmed, reason: 'no .dev-team-agent workspace found' })
    }
    for (const c of found) candidates.add(c)
  }

  for (const candidate of candidates) {
    report.scanned += 1
    const result = addFn({ path: candidate })
    if ('error' in result) {
      report.hits.push({ path: candidate, project: null, status: 'error', error: result.error })
      report.errors.push({ path: candidate, error: result.error })
      continue
    }
    const project = result.project
    // After validate, registry stores canonical `.dev-team-agent` path.
    const wasKnown = knownPaths.has(project.path)
    if (wasKnown) {
      report.hits.push({ path: candidate, project, status: 'existing' })
      report.existing.push(project)
    } else {
      knownPaths.add(project.path)
      report.hits.push({ path: candidate, project, status: 'added' })
      report.added.push(project)
    }
  }

  return report
}
