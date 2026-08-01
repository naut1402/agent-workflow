import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'

/** Best-effort home directory (Windows USERPROFILE first, then HOME). */
export function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || ''
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

/** @deprecated Import from `@/core/lib/yamlLib` — kept for callers still on contracts/fs. */
export { readYamlSafe } from '../lib/yamlLib.js'
