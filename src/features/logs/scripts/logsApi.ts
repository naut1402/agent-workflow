import { apiGet } from '../../../core/http/client'

export async function fetchLogs(
  { type, project, limit }: { type?: string; project?: string; limit?: number } = {},
) {
  return apiGet('/api/logs', { type, project, limit })
}

export interface FetchJobLogOptions {
  offset?: number
  wait?: number
}

export async function fetchJobLog(id: string, opts: FetchJobLogOptions = {}) {
  return apiGet(`/api/jobs/${encodeURIComponent(id)}/log`, {
    offset: opts.offset,
    wait: opts.wait,
  })
}
