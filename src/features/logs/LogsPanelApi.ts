import { apiGet } from '../../api/http'

export async function fetchLogs(
  { type, project, limit }: { type?: string; project?: string; limit?: number } = {},
) {
  return apiGet('/api/logs', { type, project, limit })
}

export interface FetchJobLogOptions {
  /** Byte cursor the client already consumed. */
  offset?: number
  /** Long-poll wait hint (ms) for delta log endpoint. */
  wait?: number
}

export async function fetchJobLog(id: string, opts: FetchJobLogOptions = {}) {
  return apiGet(`/api/jobs/${encodeURIComponent(id)}/log`, {
    offset: opts.offset,
    wait: opts.wait,
  })
}
