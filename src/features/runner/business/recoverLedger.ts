import { joinPath, mkdirSync, readTextFileSync, readdirSync, renameSync, rmSync, writeTextFileSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import type { JobFailureKind } from './types.js'

export interface RecoverEntry {
  version: 1
  jobId: string
  kind: JobFailureKind
  attemptCount: number
  resumeAfter: string
  createdAt: string
  lastError?: string
  usageResetAt?: string | null
}

function recoverDir(): string {
  return joinPath(registryHome(), 'recover')
}

function recoverFile(jobId: string): string {
  return joinPath(recoverDir(), `${jobId}.json`)
}

export function saveRecoverEntry(entry: RecoverEntry): void {
  mkdirSync(recoverDir(), { recursive: true })
  const file = recoverFile(entry.jobId)
  const tmp = `${file}.tmp`
  writeTextFileSync(tmp, JSON.stringify(entry, null, 2))
  renameSync(tmp, file)
}

export function loadRecoverEntry(jobId: string): RecoverEntry | null {
  try {
    const raw = readTextFileSync(recoverFile(jobId))
    const data = JSON.parse(raw) as RecoverEntry
    if (!data || data.version !== 1 || data.jobId !== jobId) return null
    return data
  } catch {
    return null
  }
}

export function removeRecoverEntry(jobId: string): void {
  try {
    rmSync(recoverFile(jobId), { force: true })
  } catch {
    /* absent ok */
  }
}

export function listRecoverEntries(): RecoverEntry[] {
  let files: string[] = []
  try {
    files = readdirSync(recoverDir()).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
  } catch {
    return []
  }
  const entries: RecoverEntry[] = []
  for (const f of files) {
    const jobId = f.replace(/\.json$/, '')
    const entry = loadRecoverEntry(jobId)
    if (entry) entries.push(entry)
  }
  return entries
}
