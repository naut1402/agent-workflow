// Global request/audit log + per-job execution log.

import { qs } from '../http'

export async function fetchLogs(
  { type, project, limit }: { type?: string; project?: string; limit?: number } = {},
) {
  const r = await fetch(`/api/logs${qs({ type, project, limit })}`)
  if (!r.ok) throw new Error(`/api/logs → ${r.status}`)
  return r.json()
}

export interface FetchJobLogOptions {
  /** Byte cursor the client already consumed. */
  offset?: number
  /** Long-poll wait hint (ms) for delta log endpoint. */
  wait?: number
}

export async function fetchJobLog(id: string, opts: FetchJobLogOptions = {}) {
  const r = await fetch(
    `/api/jobs/${encodeURIComponent(id)}/log${qs({ offset: opts.offset, wait: opts.wait })}`,
  )
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${id}/log → ${r.status}`)
  return data
}
