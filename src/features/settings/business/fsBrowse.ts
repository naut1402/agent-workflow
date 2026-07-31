// Directory browser for the local folder-picker UI. Lists directories only —
// never file contents. Defensive: missing/unreadable paths → empty entries.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { homeDir, safeReadDir } from '../../../core/contracts/fs.js'

export interface BrowseEntry {
  name: string
  path: string
  isDirectory: true
}

export interface BrowseResult {
  path: string
  parent: string | null
  entries: BrowseEntry[]
  /** True when listing OS roots / drive letters (not a real directory). */
  roots: boolean
}

export type BrowseOutcome =
  | { ok: true; result: BrowseResult }
  | { ok: false; status: number; error: string }

const ROOTS_SENTINEL = ''

/** List Windows drive letters that currently exist (C:\, D:\, …). */
function windowsDrives(): BrowseEntry[] {
  const out: BrowseEntry[] = []
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i)
    const root = `${letter}:\\`
    try {
      if (fs.existsSync(root)) {
        out.push({ name: `${letter}:`, path: root, isDirectory: true })
      }
    } catch {
      /* ignore */
    }
  }
  return out
}

function listRoots(): BrowseResult {
  if (process.platform === 'win32') {
    return { path: ROOTS_SENTINEL, parent: null, entries: windowsDrives(), roots: true }
  }
  return {
    path: ROOTS_SENTINEL,
    parent: null,
    entries: [{ name: '/', path: '/', isDirectory: true }],
    roots: true,
  }
}

function parentOf(abs: string): string | null {
  const parent = path.dirname(abs)
  // At filesystem root (/, C:\): next "up" is the roots list.
  if (parent === abs) return ROOTS_SENTINEL
  // Windows: dirname('C:\\') === 'C:\\'
  if (process.platform === 'win32') {
    const parsed = path.parse(abs)
    if (parsed.root === abs) return ROOTS_SENTINEL
  }
  return parent
}

/**
 * Browse a directory for subdirectories.
 * - Empty / missing path → user home (or roots if home unavailable).
 * - Special: path exactly matching roots sentinel after navigating "up" from a drive root.
 */
export async function browseDirectory(input: unknown): Promise<BrowseOutcome> {
  // Explicit roots listing (empty string after "up" from drive root).
  if (input === ROOTS_SENTINEL || input === null || input === undefined) {
    const home = homeDir() || os.homedir()
    if (!home) return { ok: true, result: listRoots() }
    // Default landing: home directory.
    return browseAbsolute(path.resolve(home))
  }

  if (typeof input !== 'string') {
    return { ok: false, status: 400, error: 'path must be a string' }
  }

  const raw = input.trim()
  if (!raw) {
    const home = homeDir() || os.homedir()
    if (!home) return { ok: true, result: listRoots() }
    return browseAbsolute(path.resolve(home))
  }

  // Client may send the roots sentinel as empty after trim — already handled.
  // Allow an explicit "__roots__" token for the picker "Computer" button.
  if (raw === '__roots__') {
    return { ok: true, result: listRoots() }
  }

  if (!path.isAbsolute(raw)) {
    return { ok: false, status: 400, error: 'path must be absolute' }
  }

  return browseAbsolute(path.resolve(raw))
}

async function browseAbsolute(abs: string): Promise<BrowseOutcome> {
  let canonical: string
  try {
    canonical = fs.realpathSync(abs)
  } catch {
    // Path may not exist yet / broken symlink — still try listing if it's a dir.
    canonical = abs
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(canonical)
  } catch {
    return { ok: false, status: 400, error: 'path not found' }
  }
  if (!stat.isDirectory()) {
    return { ok: false, status: 400, error: 'path must be a directory' }
  }

  const dirents = await safeReadDir(canonical)
  const entries: BrowseEntry[] = []
  for (const d of dirents) {
    if (!d.isDirectory()) continue
    // Skip common noise / inaccessible.
    if (d.name === '.' || d.name === '..') continue
    entries.push({
      name: d.name,
      path: path.join(canonical, d.name),
      isDirectory: true,
    })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return {
    ok: true,
    result: {
      path: canonical,
      parent: parentOf(canonical),
      entries,
      roots: false,
    },
  }
}
