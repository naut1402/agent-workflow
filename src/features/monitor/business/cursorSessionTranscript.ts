import { existsSync, joinPath, readdirSync, statSync } from '../../../core/lib/fileHelper.js'
import fs from 'node:fs'
import os from 'node:os'
import {
  type ReadTranscriptOptions,
  type TranscriptResult,
  type TranscriptTurn,
} from './sessionTranscript.js'

/**
 * Read Cursor Agent CLI / IDE session transcripts.
 *
 * Cursor stores agent transcripts under project folders, e.g.:
 *   ~/.cursor/projects/<slug>/agent-transcripts/<sessionId>.jsonl
 *   ~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl
 *
 * Format varies (Claude-like JSONL or `{role, message|text, type}`). Missing
 * files return empty turns — never throw (chat UI shows transcriptFound: false).
 */

const MAX_TURN_CHARS = 4000
const MAX_TURNS = 200
const MAX_SCAN_DIRS = 400
const MAX_SCAN_FILES = 800
/** Cap I/O — only the tail of the transcript is loaded for chat UI. */
const MAX_READ_BYTES = 512 * 1024

function cursorHome(): string {
  const override = process.env.CURSOR_CONFIG_DIR
  if (override && override.trim()) return override.trim()
  return joinPath(os.homedir(), '.cursor')
}

function clip(text: string): string {
  const t = text.trim()
  return t.length > MAX_TURN_CHARS ? `${t.slice(0, MAX_TURN_CHARS)}\n…(đã cắt bớt)` : t
}

/** Read at most the last `maxBytes` of a file (UTF-8); drops a partial leading line. */
export function readTextFileTailSync(file: string, maxBytes = MAX_READ_BYTES): string {
  const size = statSync(file).size
  if (size <= 0) return ''
  if (size <= maxBytes) return fs.readFileSync(file, 'utf8')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    fs.readSync(fd, buf, 0, maxBytes, size - maxBytes)
    const text = buf.toString('utf8')
    const nl = text.indexOf('\n')
    return nl >= 0 ? text.slice(nl + 1) : text
  } finally {
    fs.closeSync(fd)
  }
}

function projectsRoot(): string {
  return joinPath(cursorHome(), 'projects')
}

/**
 * Locate a Cursor transcript file for `sessionId`.
 * Accepts uuid or uuid.jsonl; scans agent-transcripts trees defensively.
 */
export function findCursorTranscriptFile(sessionId: string, _workspace?: string): string | null {
  if (!sessionId || /[^\w-]/.test(sessionId)) return null
  const root = projectsRoot()
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(root)
  } catch {
    return null
  }

  const candidates: string[] = []
  for (const proj of projectDirs.slice(0, MAX_SCAN_DIRS)) {
    const base = joinPath(root, proj, 'agent-transcripts')
    candidates.push(joinPath(base, `${sessionId}.jsonl`))
    candidates.push(joinPath(base, sessionId, `${sessionId}.jsonl`))
  }

  for (const c of candidates) {
    if (existsSync(c)) return c
  }

  // Bounded deep scan: match filename containing session id
  let scanned = 0
  for (const proj of projectDirs.slice(0, MAX_SCAN_DIRS)) {
    const base = joinPath(root, proj, 'agent-transcripts')
    let entries: string[]
    try {
      entries = readdirSync(base)
    } catch {
      continue
    }
    for (const name of entries) {
      if (scanned++ > MAX_SCAN_FILES) return null
      const full = joinPath(base, name)
      if (name === `${sessionId}.jsonl` || name === sessionId) {
        if (name.endsWith('.jsonl') && existsSync(full)) return full
        const nested = joinPath(full, `${sessionId}.jsonl`)
        if (existsSync(nested)) return nested
        // directory of many jsonl — pick first matching
        try {
          for (const f of readdirSync(full)) {
            if (f.includes(sessionId) && f.endsWith('.jsonl')) {
              const p = joinPath(full, f)
              if (existsSync(p)) return p
            }
          }
        } catch {
          /* ignore */
        }
      }
      if (name.includes(sessionId) && name.endsWith('.jsonl') && existsSync(full)) return full
    }
  }
  return null
}

/**
 * Cursor CLI writes user turns wrapped as `<timestamp>…</timestamp><user_query>…</user_query>`
 * (sometimes without the `<timestamp>` prefix) — strip it so the chat UI shows
 * plain text instead of the raw framing. No-op (returns `text` unchanged) when
 * the string doesn't match the expected wrapper exactly, so a CLI format change
 * degrades to "shows the wrapper" rather than losing/mangling content.
 */
export function stripCursorUserWrapper(text: string): string {
  const full = text.match(/^<timestamp>[\s\S]*?<\/timestamp>\s*<user_query>([\s\S]*?)<\/user_query>\s*$/)
  if (full) return full[1].trim()
  const onlyQuery = text.match(/^<user_query>([\s\S]*?)<\/user_query>\s*$/)
  if (onlyQuery) return onlyQuery[1].trim()
  return text
}

function textFromCursorEntry(entry: Record<string, unknown>): { role: 'user' | 'assistant' | null; text: string; at?: string } {
  const at =
    typeof entry.timestamp === 'string'
      ? entry.timestamp
      : typeof entry.createdAt === 'string'
        ? entry.createdAt
        : undefined

  // Claude-compatible shape
  if (entry.type === 'user' || entry.type === 'assistant') {
    const message = entry.message as Record<string, unknown> | undefined
    const content = message?.content
    if (typeof content === 'string') return { role: entry.type, text: stripCursorUserWrapper(content), at }
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const raw of content) {
        const block = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
        if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
      return { role: entry.type, text: stripCursorUserWrapper(parts.join('\n')), at }
    }
  }

  // Flat Cursor / agent-transcript style
  const roleRaw = typeof entry.role === 'string' ? entry.role : typeof entry.type === 'string' ? entry.type : ''
  let role: 'user' | 'assistant' | null = null
  if (roleRaw === 'user' || roleRaw === 'human') role = 'user'
  else if (roleRaw === 'assistant' || roleRaw === 'ai' || roleRaw === 'agent') role = 'assistant'
  if (!role) return { role: null, text: '' }

  if (typeof entry.text === 'string') return { role, text: stripCursorUserWrapper(entry.text), at }
  if (typeof entry.message === 'string') return { role, text: stripCursorUserWrapper(entry.message), at }
  if (typeof entry.content === 'string') return { role, text: stripCursorUserWrapper(entry.content), at }

  // Nested `{ message: { content: string | blocks[] } }` (Cursor agent-transcript)
  const message = entry.message && typeof entry.message === 'object' ? (entry.message as Record<string, unknown>) : null
  const nested = message?.content ?? entry.content
  if (typeof nested === 'string') return { role, text: stripCursorUserWrapper(nested), at }
  if (Array.isArray(nested)) {
    const parts: string[] = []
    for (const raw of nested) {
      const block = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      else if (typeof raw === 'string') parts.push(raw)
    }
    return { role, text: stripCursorUserWrapper(parts.join('\n')), at }
  }
  return { role, text: '', at }
}

/** Parse Cursor JSONL (or Claude-compatible) into turns — only the file tail is read. */
export function readCursorTranscript(file: string, opts: ReadTranscriptOptions = {}): TranscriptResult {
  let raw = ''
  try {
    raw = readTextFileTailSync(file)
  } catch {
    return { turns: [], total: 0 }
  }

  const all: TranscriptTurn[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.isSidechain === true) continue
    const { role, text, at } = textFromCursorEntry(entry)
    if (!role || !text.trim()) continue
    all.push({ index: all.length, role, text: clip(text), at })
  }

  const windowed = all.slice(Math.max(0, all.length - MAX_TURNS))
  const total = all.length
  const from = opts.fromIndex ?? 0
  return { turns: windowed.filter((t) => t.index >= from), total }
}

export function readCursorSessionTranscript(
  sessionId: string,
  workspace?: string,
  opts: ReadTranscriptOptions = {},
): TranscriptResult & { file: string | null } {
  const file = findCursorTranscriptFile(sessionId, workspace)
  if (!file) return { turns: [], total: 0, file: null }
  return { ...readCursorTranscript(file, opts), file }
}

/** @internal test helper */
export function _cursorProjectsRootForTest(): string {
  return projectsRoot()
}
