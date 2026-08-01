import fs from 'node:fs/promises'
import path from 'node:path'
import { registryHome } from '../registry.js'
import { statSafe } from '../contracts/fs.js'
import type { LogEntry, LogType } from './schema.js'

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
