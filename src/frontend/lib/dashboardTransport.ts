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

/**
 * Cờ transport (env Docker `DEV_TEAM_DASHBOARD_TRANSPORT`, lộ qua
 * `/api/security-config`) — cached cho cả phiên trang (module-level singleton),
 * nên đổi env giữa lúc phiên đang mở chỉ áp dụng sau khi tải lại trang. Fetch
 * lỗi / field thiếu (client cache cũ) → mặc định 'sse', khớp default backend.
 */
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
