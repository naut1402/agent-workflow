export type DashboardTransport = 'sse' | 'polling'

/** `DEV_TEAM_DASHBOARD_TRANSPORT=sse|polling` — cơ chế đẩy dữ liệu cho chat/automations/job-log; thiếu/lạ → `'sse'`. */
export function getDashboardTransport(): DashboardTransport {
  const raw = (process.env.DEV_TEAM_DASHBOARD_TRANSPORT || '').trim().toLowerCase()
  return raw === 'polling' ? 'polling' : 'sse'
}
