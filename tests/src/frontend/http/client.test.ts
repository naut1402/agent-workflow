import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiGet, apiGetText, apiPost, apiRequest, isAbortError } from '@/frontend/http/client'

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

/** fetch giả tôn trọng `signal` như trình duyệt: treo tới khi bị huỷ hoặc được thả. */
function hangingFetch() {
  let release!: (body: unknown) => void
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) return reject(abortError())
        signal?.addEventListener('abort', () => reject(abortError()))
        release = (body) => resolve(new Response(JSON.stringify(body), { status: 200 }))
      }),
  )
  return { fetchMock, release: (body: unknown) => release(body) }
}

function okFetch(body: unknown = { ok: 1 }) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ApiRequestOptions.signal', () => {
  it('TC-H01 · apiRequest / apiGet / apiPost chuyển đúng signal xuống fetch', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const ac = new AbortController()

    await apiRequest('PUT', '/api/x', { body: { a: 1 }, signal: ac.signal })
    await apiGet('/api/x', { project: 'p1' }, { signal: ac.signal })
    await apiPost('/api/x', { a: 1 }, { signal: ac.signal })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchMock.mock.calls) expect(init!.signal).toBe(ac.signal)
  })

  it('TC-H02 · không truyền signal → hành vi cũ, request vẫn thành công', async () => {
    const fetchMock = okFetch({ v: 42 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGet('/api/x')).resolves.toEqual({ v: 42 })
    expect(fetchMock.mock.calls[0]![1]!.signal).toBeUndefined()
  })

  it('TC-H03 · huỷ khi request đang bay → reject AbortError, không log lỗi', async () => {
    const { fetchMock } = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ac = new AbortController()

    const p = apiPost('/api/x', { a: 1 }, { signal: ac.signal })
    ac.abort()

    const err = await p.catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(logged).not.toHaveBeenCalled()
  })

  it('TC-H04 · signal đã huỷ từ trước → không ra kết quả thành công', async () => {
    vi.stubGlobal('fetch', hangingFetch().fetchMock)
    const ac = new AbortController()
    ac.abort()

    const err = await apiGet('/api/x', undefined, { signal: ac.signal }).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
  })

  it('TC-H05 · huỷ lúc đang đọc body → reject AbortError thay vì trả `{}` như thành công', async () => {
    const ac = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          ac.abort()
          throw abortError()
        },
      })),
    )

    const err = await apiGet('/api/x', undefined, { signal: ac.signal }).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
  })

  it('TC-H06 · lỗi HTTP thật khi có signal vẫn là lỗi thật (status giữ nguyên)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Conflict' }), { status: 409 })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const err = await apiPost('/api/x', {}, { signal: new AbortController().signal }).catch((e) => e)
    expect(err.status).toBe(409)
    expect(err.message).toBe('Conflict')
    expect(isAbortError(err)).toBe(false)
  })

  it('TC-H07 · apiGetText nhận signal ở tham số thứ ba và huỷ được', async () => {
    const { fetchMock } = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const ac = new AbortController()

    const p = apiGetText('/api/raw', { project: 'p1' }, { signal: ac.signal })
    expect(fetchMock.mock.calls[0]![1]!.signal).toBe(ac.signal)
    ac.abort()

    expect(isAbortError(await p.catch((e) => e))).toBe(true)
  })
})

describe('isAbortError', () => {
  it.each([
    ['DOMException AbortError', abortError(), true],
    ['Error có name AbortError', Object.assign(new Error('x'), { name: 'AbortError' }), true],
    ['Error thường', new Error('boom'), false],
    ['lỗi HTTP có status', Object.assign(new Error('Bad'), { status: 400 }), false],
    ['DOMException khác loại', new DOMException('t', 'TimeoutError'), false],
    ['null', null, false],
    ['undefined', undefined, false],
    ['chuỗi', 'AbortError', false],
  ])('TC-H08 · %s → %s', (_label, input, expected) => {
    expect(isAbortError(input)).toBe(expected)
  })
})
