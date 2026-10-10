export type DashboardTransport = 'sse' | 'polling'

/**
 * `DEV_TEAM_DASHBOARD_TRANSPORT=sse|polling` (Docker env) — chọn cơ chế đẩy dữ
 * liệu cho chat/automations/job-log, vì SSE bị buffer bởi proxy/gateway ở một số
 * mạng nội bộ công ty. Giá trị thiếu/lạ → 'sse' (mặc định an toàn: không cần cấu
 * hình gì vẫn dùng được; nhánh 'polling' là lối thoát opt-in cho mạng bị buffer).
 */
export function getDashboardTransport(): DashboardTransport {
  const raw = (process.env.DEV_TEAM_DASHBOARD_TRANSPORT || '').trim().toLowerCase()
  return raw === 'polling' ? 'polling' : 'sse'
}
