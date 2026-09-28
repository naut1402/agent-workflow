import { afterEach, describe, expect, it, vi } from 'vitest'

// `ensureDashboardTransport()`/`isSseEnabled()` (Tfe0c91ca — toggle SSE/polling,
// D1). Module có state singleton (`cached`/`inflight`) theo đúng thiết kế
// (§4.2: "cached cho cả phiên trang") — mỗi test cần cây module SẠCH nên
// `vi.resetModules()` + import động lại, thay vì import tĩnh ở đầu file.

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('dashboardTransport (frontend)', () => {
  it('TC17: response không có field transport (client cache cũ, chưa có field) → mặc định sse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ jwtEnabled: false }) })))
    const { ensureDashboardTransport, isSseEnabled } = await import('@/frontend/lib/dashboardTransport')
    const t = await ensureDashboardTransport()
    expect(t).toBe('sse')
    expect(isSseEnabled(t)).toBe(true)
  })

  it('fetch lỗi (mất mạng / server down) → mặc định sse, không throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const { ensureDashboardTransport } = await import('@/frontend/lib/dashboardTransport')
    await expect(ensureDashboardTransport()).resolves.toBe('sse')
  })

  it('response transport=polling → isSseEnabled() trả false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ transport: 'polling' }) })))
    const { ensureDashboardTransport, isSseEnabled } = await import('@/frontend/lib/dashboardTransport')
    const t = await ensureDashboardTransport()
    expect(t).toBe('polling')
    expect(isSseEnabled(t)).toBe(false)
  })

  it('TC18: cached module-level — gọi lại trong cùng phiên không fetch lại, dù giá trị mới (giả lập đổi env) khác', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ transport: 'sse' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ transport: 'polling' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardTransport } = await import('@/frontend/lib/dashboardTransport')

    const first = await ensureDashboardTransport()
    const second = await ensureDashboardTransport()
    expect(first).toBe('sse')
    // Env đổi giữa lúc phiên đang mở (design.md §4.4) chỉ áp dụng sau khi tải
    // lại trang — module cache không tự invalidate.
    expect(second).toBe('sse')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('concurrent callers chia sẻ đúng một request in-flight, không gọi fetch hai lần', async () => {
    let resolveFetch!: (v: unknown) => void
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { ensureDashboardTransport } = await import('@/frontend/lib/dashboardTransport')

    const p1 = ensureDashboardTransport()
    const p2 = ensureDashboardTransport()
    resolveFetch({ ok: true, json: async () => ({ transport: 'sse' }) })
    const [t1, t2] = await Promise.all([p1, p2])

    expect(t1).toBe('sse')
    expect(t2).toBe('sse')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
