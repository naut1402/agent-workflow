/**
 * Minimal knowledge document versioning — immutable revision files.
 *
 * Layout: `<knowledgeRoot>/<scope>/<slug>.md` (current)
 *         `<knowledgeRoot>/<scope>/.versions/<slug>/<iso>.md`
 */

import {
  existsSync,
  joinPath,
  mkdirSync,
  readTextFileSync,
  readdirSync,
  writeTextFileSync,
} from '../../../core/lib/fileHelper.js'
import { knowledgeRoot } from './fileDriver.js'

function versionsDir(devTeamRoot: string, scope: string, slug: string): string {
  return joinPath(knowledgeRoot(devTeamRoot), scope, '.versions', slug)
}

function sanitiseSlug(slug: string): string | null {
  if (!slug || /[\\/\0]/.test(slug)) return null
  const clean = slug.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return clean || null
}

export interface KnowledgeRevision {
  id: string
  at: string
  path: string
}

export function listKnowledgeRevisions(
  devTeamRoot: string,
  scope: string,
  slug: string,
): KnowledgeRevision[] {
  const s = sanitiseSlug(slug)
  if (!s || (scope !== 'project' && scope !== 'system')) return []
  const dir = versionsDir(devTeamRoot, scope, s)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
      .map((f) => ({
        id: f.replace(/\.md$/, ''),
        at: f.replace(/\.md$/, '').replace(/-/g, ':'),
        path: joinPath(dir, f),
      }))
  } catch {
    return []
  }
}

/** Snapshot current file into .versions before overwrite. */
export function snapshotKnowledgeRevision(
  devTeamRoot: string,
  scope: string,
  slug: string,
): KnowledgeRevision | null {
  const s = sanitiseSlug(slug)
  if (!s || (scope !== 'project' && scope !== 'system')) return null
  const current = joinPath(knowledgeRoot(devTeamRoot), scope, `${s}.md`)
  if (!existsSync(current)) return null
  const dir = versionsDir(devTeamRoot, scope, s)
  mkdirSync(dir, { recursive: true })
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = joinPath(dir, `${id}.md`)
  try {
    writeTextFileSync(dest, readTextFileSync(current))
  } catch {
    return null
  }
  return { id, at: id, path: dest }
}

export function readKnowledgeRevision(
  devTeamRoot: string,
  scope: string,
  slug: string,
  revisionId: string,
): string | null {
  const s = sanitiseSlug(slug)
  if (!s || /[^\w-]/.test(revisionId)) return null
  const file = joinPath(versionsDir(devTeamRoot, scope, s), `${revisionId}.md`)
  if (!existsSync(file)) return null
  try {
    return readTextFileSync(file)
  } catch {
    return null
  }
}

/** Restore a revision over the current file (snapshots current first). */
export function restoreKnowledgeRevision(
  devTeamRoot: string,
  scope: string,
  slug: string,
  revisionId: string,
): { ok: true } | { ok: false; error: string } {
  const content = readKnowledgeRevision(devTeamRoot, scope, slug, revisionId)
  if (content == null) return { ok: false, error: 'revision not found' }
  const s = sanitiseSlug(slug)
  if (!s) return { ok: false, error: 'invalid slug' }
  snapshotKnowledgeRevision(devTeamRoot, scope, s)
  const current = joinPath(knowledgeRoot(devTeamRoot), scope, `${s}.md`)
  try {
    writeTextFileSync(current, content)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) }
  }
}
