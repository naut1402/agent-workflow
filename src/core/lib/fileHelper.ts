import fs from 'node:fs/promises'
import path from 'node:path'
import type { Dirent } from 'node:fs'

/** Best-effort home directory (Windows USERPROFILE first, then HOME). */
export function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || ''
}

/**
 * Resolve `segments` under `baseDir`. Returns null if the result escapes
 * `baseDir` (path-traversal guard).
 */
export function resolvePathUnder(baseDir: string, ...segments: string[]): string | null {
  const base = path.resolve(baseDir)
  const target = path.resolve(base, ...segments)
  if (target !== base && !target.startsWith(base + path.sep)) return null
  return target
}

/** Read a directory, returning [] instead of throwing on any error. */
export async function safeReadDir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export interface StatInfo {
  exists: boolean
  mtime: number | null
  size: number
}

/** Stat a path, returning a defensive {exists:false} record on any error. */
export async function statSafe(p: string): Promise<StatInfo> {
  try {
    const s = await fs.stat(p)
    return { exists: true, mtime: s.mtimeMs, size: s.size }
  } catch {
    return { exists: false, mtime: null, size: 0 }
  }
}
