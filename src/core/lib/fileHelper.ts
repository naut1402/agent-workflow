import fsPromises from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
// Namespace imports — named `from 'node:*'` is rewritten by Vite to property
// access at module init (`ext["fileURLToPath"]` / `ext["randomBytes"]`), which
// throws in the browser if this file is ever pulled into the client graph.
// Defer access to call sites.
import * as nodeUrl from 'node:url'
import * as nodeCrypto from 'node:crypto'
import type {
  Dirent,
  PathLike,
  Stats,
  FSWatcher,
} from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

export type { Dirent, Stats, FSWatcher, FileHandle }

/** Best-effort home directory (Windows USERPROFILE first, then HOME). */
export function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || ''
}

// ── path wrappers ──────────────────────────────────────────────────────────

export function joinPath(...parts: string[]): string {
  return path.join(...parts)
}

export function resolvePath(...parts: string[]): string {
  return path.resolve(...parts)
}

export function dirname(p: string): string {
  return path.dirname(p)
}

export function basename(p: string, suffix?: string): string {
  return path.basename(p, suffix)
}

export function extname(p: string): string {
  return path.extname(p)
}

export function relativePath(from: string, to: string): string {
  return path.relative(from, to)
}

export function isAbsolutePath(p: string): boolean {
  return path.isAbsolute(p)
}

export function parsePath(p: string): path.ParsedPath {
  return path.parse(p)
}

/** `fileURLToPath` — convert `file:` URL / `import.meta.url` to a filesystem path. */
export function fileURLToPath(url: string | URL): string {
  return nodeUrl.fileURLToPath(url)
}

/** `pathToFileURL` — convert a filesystem path to a `file:` URL (dynamic `import`). */
export function pathToFileURL(p: string): URL {
  return nodeUrl.pathToFileURL(p)
}

/** Directory containing the module that owns `import.meta.url`. */
export function dirnameFromImportMeta(importMetaUrl: string): string {
  return path.dirname(nodeUrl.fileURLToPath(importMetaUrl))
}

/** `randomBytes` — cryptographically strong random bytes (Node crypto). */
export function randomBytes(size: number): Buffer {
  return nodeCrypto.randomBytes(size)
}

/** `randomUUID` — RFC 4122 v4 UUID string (Node crypto). */
export function randomUUID(): string {
  return nodeCrypto.randomUUID()
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

// ── async fs ───────────────────────────────────────────────────────────────

/** Read a directory, returning [] instead of throwing on any error. */
export async function safeReadDir(dir: string): Promise<Dirent[]> {
  try {
    return await fsPromises.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export async function readDir(dir: string): Promise<string[]>
export async function readDir(dir: string, opts: { withFileTypes: true }): Promise<Dirent[]>
export async function readDir(
  dir: string,
  opts?: { withFileTypes?: boolean },
): Promise<string[] | Dirent[]> {
  if (opts?.withFileTypes) {
    return fsPromises.readdir(dir, { withFileTypes: true })
  }
  return fsPromises.readdir(dir)
}

export interface StatInfo {
  exists: boolean
  mtime: number | null
  size: number
}

/** Stat a path, returning a defensive {exists:false} record on any error. */
export async function statSafe(p: string): Promise<StatInfo> {
  try {
    const s = await fsPromises.stat(p)
    return { exists: true, mtime: s.mtimeMs, size: s.size }
  } catch {
    return { exists: false, mtime: null, size: 0 }
  }
}

export async function stat(p: string): Promise<Stats> {
  return fsPromises.stat(p)
}

export async function readTextFile(p: string): Promise<string> {
  return fsPromises.readFile(p, 'utf8')
}

export async function writeTextFile(p: string, data: string | Buffer): Promise<void> {
  await fsPromises.writeFile(p, data)
}

export async function writeFile(
  p: string,
  data: string | Buffer,
  encoding?: BufferEncoding,
): Promise<void> {
  if (encoding) await fsPromises.writeFile(p, data, encoding)
  else await fsPromises.writeFile(p, data)
}

export async function readFile(
  p: string,
  encoding: BufferEncoding = 'utf8',
): Promise<string> {
  return fsPromises.readFile(p, encoding)
}

export async function mkdir(
  p: string,
  opts?: { recursive?: boolean },
): Promise<string | undefined> {
  return fsPromises.mkdir(p, opts)
}

export async function access(p: string, mode?: number): Promise<void> {
  return fsPromises.access(p, mode)
}

export async function rename(from: string, to: string): Promise<void> {
  await fsPromises.rename(from, to)
}

export async function rm(
  p: string,
  opts?: { recursive?: boolean; force?: boolean },
): Promise<void> {
  await fsPromises.rm(p, opts)
}

export async function unlink(p: string): Promise<void> {
  await fsPromises.unlink(p)
}

export async function openFile(
  p: PathLike,
  flags?: string | number,
): Promise<FileHandle> {
  return fsPromises.open(p, flags)
}

// ── sync fs ────────────────────────────────────────────────────────────────

export function existsSync(p: string): boolean {
  return fs.existsSync(p)
}

export function readTextFileSync(p: string): string {
  return fs.readFileSync(p, 'utf8')
}

export function writeTextFileSync(p: string, data: string): void {
  fs.writeFileSync(p, data, 'utf8')
}

export function appendTextFileSync(p: string, data: string): void {
  fs.appendFileSync(p, data, 'utf8')
}

export function mkdirSync(p: string, opts?: { recursive?: boolean }): string | undefined {
  return fs.mkdirSync(p, opts) ?? undefined
}

export function renameSync(from: string, to: string): void {
  fs.renameSync(from, to)
}

export function copyFileSync(from: string, to: string): void {
  fs.copyFileSync(from, to)
}

/**
 * Best-effort atomic text write: temp file + rename. Some filesystems (Docker
 * bind mounts, SMB/NFS shares, antivirus-scanned dirs) return EBUSY/EPERM
 * transiently when rename targets an existing file — retry briefly, then fall
 * back to copy-over + unlink, which those filesystems do allow.
 */
export function writeTextFileAtomicSync(file: string, data: string): void {
  const tmp = `${file}.tmp`
  writeTextFileSync(tmp, data)
  if (renameOverExisting(tmp, file)) return
  copyFileSync(tmp, file)
  rmSync(tmp, { force: true })
}

function renameOverExisting(from: string, to: string): boolean {
  try {
    renameSync(from, to)
    return true
  } catch (err: any) {
    if (!isTransientRenameError(err)) throw err
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    busyWaitMs(20)
    try {
      renameSync(from, to)
      return true
    } catch (err: any) {
      if (!isTransientRenameError(err)) throw err
    }
  }
  return false
}

function isTransientRenameError(err: any): boolean {
  return Boolean(err) && ['EBUSY', 'EPERM', 'EACCES'].includes(String(err.code))
}

function busyWaitMs(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* spin */
  }
}

export function rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }): void {
  fs.rmSync(p, opts)
}

export function readdirSync(dir: string): string[]
export function readdirSync(dir: string, opts: { withFileTypes: true }): Dirent[]
export function readdirSync(
  dir: string,
  opts?: { withFileTypes?: boolean },
): string[] | Dirent[] {
  if (opts?.withFileTypes) {
    return fs.readdirSync(dir, { withFileTypes: true })
  }
  return fs.readdirSync(dir)
}

export function statSync(p: string): Stats {
  return fs.statSync(p)
}

export function realpathSync(p: string): string {
  return fs.realpathSync(p)
}

export function cpSync(
  src: string,
  dest: string,
  opts?: { recursive?: boolean },
): void {
  fs.cpSync(src, dest, opts)
}

export function watch(...args: Parameters<typeof fs.watch>): FSWatcher {
  return fs.watch(...args)
}
