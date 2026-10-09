import { apiGet } from '../http/client'

export type DashboardTransport = 'sse' | 'polling'

let cached: DashboardTransport | null = null
let inflight: Promise<DashboardTransport> | null = null

async function fetchTransport(): Promise<DashboardTransport> {
  try {
    const data = await apiGet('/api/security-config')
    return data?.transport === 'polling' ? 'polling' : 'sse'
  } catch {
    return 'sse'
  }
}

/** Cờ transport lấy từ `/api/security-config`, cache cho cả phiên trang; lỗi hoặc thiếu field → `'sse'`. */
export function ensureDashboardTransport(): Promise<DashboardTransport> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = fetchTransport().then((t) => {
      cached = t
      return t
    })
  }
  return inflight
}

export function isSseEnabled(transport: DashboardTransport): boolean {
  return transport !== 'polling'
}
