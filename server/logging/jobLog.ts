import fs from 'node:fs/promises'
import path from 'node:path'
import { registryHome } from '../registry.js'
import { sanitiseJobId } from '../../shared/sanitize.js'

// Tail reader for job execution logs at `~/.dev-team-dashboard/jobs/<id>.log`
// (written by the runner in server/runners/jobQueue.ts). Reads only the last
// `tailBytes` so polling a growing log stays cheap.

const DEFAULT_TAIL_BYTES = 64 * 1024

export type JobLogResult =
  | { ok: true; text: string; size: number; truncated: boolean }
  | { ok: false; status: number; error: string }

export async function readJobLog(
  rawId: unknown,
  tailBytes = DEFAULT_TAIL_BYTES,
): Promise<JobLogResult> {
  const id = sanitiseJobId(rawId)
  if (!id) return { ok: false, status: 400, error: 'invalid job id' }

  const file = path.join(registryHome(), 'jobs', `${id}.log`)
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(file, 'r')
    const { size } = await handle.stat()
    if (size === 0) return { ok: true, text: '', size: 0, truncated: false }
    const start = size > tailBytes ? size - tailBytes : 0
    const length = size - start
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, start)
    return { ok: true, text: buf.toString('utf8'), size, truncated: start > 0 }
  } catch {
    // Missing file = job not started or produced no output yet → empty, not 404.
    return { ok: true, text: '', size: 0, truncated: false }
  } finally {
    await handle?.close().catch(() => {})
  }
}
