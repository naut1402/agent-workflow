import fs from 'node:fs/promises'
import path from 'node:path'
import { registryHome } from '../registry.js'
import { readTextFile, statSafe } from '../lib/fileHelper.js'
import { parseLogLine, type LogEntry, type LogType } from '../../shared/log/schema.js'
import { logQueryTypes, type LogDriver, type LogQuery } from './driver.js'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB per file; one .1 backup on rotation.

export function logsDir(): string {
  return path.join(registryHome(), 'logs')
}

export function logFile(type: LogType): string {
  return path.join(logsDir(), `${type}.jsonl`)
}

async function rotateIfNeeded(file: string): Promise<void> {
  const info = await statSafe(file)
  if (info.exists && info.size > MAX_BYTES) {
    try {
      await fs.rename(file, `${file}.1`)
    } catch {
      /* keep appending rather than lose the write */
    }
  }
}

/** File JSONL driver — append-only under `~/.dev-team-dashboard/logs/`. */
export async function appendFileLog(entry: LogEntry): Promise<void> {
  const dir = logsDir()
  await fs.mkdir(dir, { recursive: true })
  const file = logFile(entry.type)
  await rotateIfNeeded(file)
  await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
}

/**
 * Đọc JSONL — mỗi type một file (chỉ file sống, không đọc bản `.1`), parse phòng thủ,
 * gộp mọi type rồi sort newest-first và cắt `limit` trong bộ nhớ.
 */
async function queryFileLogs(q: LogQuery): Promise<LogEntry[]> {
  const project = q.project ?? null
  const out: LogEntry[] = []
  for (const t of logQueryTypes(q)) {
    let raw: string
    try {
      raw = await readTextFile(logFile(t))
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const entry = parseLogLine(line)
      if (!entry) continue
      if (project !== null && entry.projectId !== project) continue
      out.push(entry)
    }
  }
  out.sort((a, b) => b.ts - a.ts)
  return q.limit == null ? out : out.slice(0, q.limit)
}

/** Revision = `mtime:size` của file sống; file chưa có → `'missing'`. */
async function fileLogRevision(type: LogType): Promise<string> {
  const info = await statSafe(logFile(type))
  return info.exists ? `${info.mtime}:${info.size}` : 'missing'
}

export const fileLogDriver: LogDriver = {
  append: appendFileLog,
  query: queryFileLogs,
  revision: fileLogRevision,
}
