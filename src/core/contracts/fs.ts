import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { loadYaml } from '../lib/yamlLib.js'

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

/** Load a YAML file; null on any error / non-object. */
export async function readYamlSafe(p: string): Promise<Record<string, any> | null> {
  try {
    const raw = await fs.readFile(p, 'utf8')
    const doc = loadYaml(raw)
    return doc && typeof doc === 'object' ? (doc as Record<string, any>) : null
  } catch {
    return null
  }
}
