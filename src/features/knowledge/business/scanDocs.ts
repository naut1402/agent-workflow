/**
 * Scan project docs for knowledge ingest candidates (Epic I).
 */

import { existsSync, joinPath, readTextFileSync, readdirSync, resolvePathUnder, statSync } from '../../../core/lib/fileHelper.js'

const DEFAULT_GLOBS = ['docs', 'README.md', 'readme.md', 'CONTRIBUTING.md', 'knowledge']
const MAX_FILES = 80
const MAX_BYTES = 256 * 1024

export interface ScanCandidate {
  relativePath: string
  absolutePath: string
  size: number
  title: string
}

function isMarkdown(name: string): boolean {
  return /\.(md|mdx|txt)$/i.test(name)
}

function walk(dir: string, root: string, out: ScanCandidate[], depth: number): void {
  if (out.length >= MAX_FILES || depth > 4) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue
    const full = joinPath(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, root, out, depth + 1)
      continue
    }
    if (!st.isFile() || !isMarkdown(name)) continue
    if (st.size > MAX_BYTES) continue
    const relativePath = full.slice(root.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
    out.push({
      relativePath,
      absolutePath: full,
      size: st.size,
      title: name.replace(/\.(md|mdx|txt)$/i, ''),
    })
    if (out.length >= MAX_FILES) return
  }
}

/**
 * Scan `projectRoot` (repo root, not .dev-team-agent) for markdown docs.
 * Paths must stay under projectRoot (resolvePathUnder).
 */
export function scanProjectDocuments(
  projectRoot: string,
  opts: { include?: string[] } = {},
): { candidates: ScanCandidate[]; error?: string } {
  if (!projectRoot || !existsSync(projectRoot)) {
    return { candidates: [], error: 'project root not found' }
  }
  const include = opts.include?.length ? opts.include : DEFAULT_GLOBS
  const candidates: ScanCandidate[] = []
  for (const rel of include) {
    const resolved = resolvePathUnder(projectRoot, rel)
    if (!resolved) continue
    let st
    try {
      st = statSync(resolved)
    } catch {
      continue
    }
    if (st.isFile() && isMarkdown(rel)) {
      candidates.push({
        relativePath: rel.replace(/\\/g, '/'),
        absolutePath: resolved,
        size: st.size,
        title: rel.split(/[/\\]/).pop()!.replace(/\.(md|mdx|txt)$/i, ''),
      })
    } else if (st.isDirectory()) {
      walk(resolved, projectRoot, candidates, 0)
    }
  }
  return { candidates }
}

export function readCandidateContent(projectRoot: string, relativePath: string): string | null {
  const resolved = resolvePathUnder(projectRoot, relativePath)
  if (!resolved || !existsSync(resolved)) return null
  try {
    const text = readTextFileSync(resolved)
    return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text
  } catch {
    return null
  }
}
