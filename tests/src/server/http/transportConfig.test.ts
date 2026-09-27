import { afterEach, describe, expect, test } from 'bun:test'
import { getDashboardTransport } from '../../../../src/backend/http/transportConfig.js'

// test-spec.md Nhóm 1 (TC01-TC04) — `DEV_TEAM_DASHBOARD_TRANSPORT` (env Docker,
// D1) chọn SSE hay polling. Mặc định an toàn: thiếu/giá trị lạ → 'sse'.

const saved = process.env.DEV_TEAM_DASHBOARD_TRANSPORT

afterEach(() => {
  if (saved === undefined) delete process.env.DEV_TEAM_DASHBOARD_TRANSPORT
  else process.env.DEV_TEAM_DASHBOARD_TRANSPORT = saved
})

describe('getDashboardTransport()', () => {
  test('TC01: biến môi trường không set → mặc định sse', () => {
    delete process.env.DEV_TEAM_DASHBOARD_TRANSPORT
    expect(getDashboardTransport()).toBe('sse')
  })

  test('TC02: set = "sse" (đúng chính tả, chữ thường) → sse', () => {
    process.env.DEV_TEAM_DASHBOARD_TRANSPORT = 'sse'
    expect(getDashboardTransport()).toBe('sse')
  })

  test('TC03: set = "polling" (đúng chính tả, chữ thường) → polling', () => {
    process.env.DEV_TEAM_DASHBOARD_TRANSPORT = 'polling'
    expect(getDashboardTransport()).toBe('polling')
  })

  test('TC04: giá trị rỗng/không hợp lệ → fallback sse, không lỗi khởi động', () => {
    process.env.DEV_TEAM_DASHBOARD_TRANSPORT = ''
    expect(getDashboardTransport()).toBe('sse')
    process.env.DEV_TEAM_DASHBOARD_TRANSPORT = 'foo'
    expect(getDashboardTransport()).toBe('sse')
  })

  // TC04 (casing/whitespace) — test-spec.md gắn cờ "cần xác nhận với Tech Lead
  // trước khi implement": không có bất biến rõ ràng trong request.md/design.md
  // §1–§3 về việc coi biến thể casing là hợp lệ hay không. Case dưới khoá đúng
  // HÀNH VI HIỆN TẠI của implementer (`.trim().toLowerCase()` trước khi so
  // sánh) — xem test-result.md mục xác nhận, không tự ý coi đây là spec chốt.
  test('TC04 (cần xác nhận): casing/whitespace khác — "SSE"/"Polling"/" polling " hiện được chuẩn hoá trước khi so sánh', () => {
    process.env.DEV_TEAM_DASHBOARD_TRANSPORT = 'SSE'
    expect(getDashboardTransport()).toBe('sse')
    process.env.DEV_TEAM_DASHBOARD_TRANSPORT = 'Polling'
    expect(getDashboardTransport()).toBe('polling')
    process.env.DEV_TEAM_DASHBOARD_TRANSPORT = '  polling  '
    expect(getDashboardTransport()).toBe('polling')
  })
})
