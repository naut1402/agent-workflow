import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAutomation,
  deleteAutomation,
  fetchAllAutomationRuns,
  fetchAutomationEventTypes,
  fetchAutomationFormOptions,
  fetchAutomationRuns,
  fetchAutomations,
  runAutomationNow,
  toggleAutomation,
  updateAutomation,
} from '@/features/automations/scripts/automationsApi'

/**
 * Lớp gọi API automations phía FE (TC-30): mọi hàm phải đi đúng method + path
 * + gắn `?project=` khi có projectId, và lỗi HTTP/mạng phải nổi lên thành Error
 * có message dùng được cho UI thay vì trả về undefined âm thầm.
 */

const fetchMock = vi.fn()

function mockJson(body: unknown, status = 200) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }))
}

function lastCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return [String(call[0]), (call[1] ?? {}) as RequestInit]
}

function lastBody(): unknown {
  const [, init] = lastCall()
  return init.body === undefined ? undefined : JSON.parse(String(init.body))
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  // Client log lỗi qua console.error — im lặng để output test đọc được.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockJson({})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

describe('đọc danh sách / metadata', () => {
  it('fetchAutomations gắn ?project= khi có projectId', async () => {
    mockJson({ automations: [{ id: 'rule-a' }] })

    const data = await fetchAutomations('P1')

    const [url] = lastCall()
    expect(url).toBe('/api/automations?project=P1')
    expect(data.automations).toEqual([{ id: 'rule-a' }])
  })

  it('fetchAutomations không có projectId → không có query (project mặc định)', async () => {
    await fetchAutomations()

    expect(lastCall()[0]).toBe('/api/automations')
  })

  it('danh sách rỗng trả về đúng hình dạng rỗng, không throw', async () => {
    mockJson({ automations: [] })

    await expect(fetchAutomations('P1')).resolves.toEqual({ automations: [] })
  })

  it('fetchAutomationEventTypes / fetchAutomationFormOptions đi đúng path', async () => {
    await fetchAutomationEventTypes('P1')
    expect(lastCall()[0]).toBe('/api/automations/event-types?project=P1')

    await fetchAutomationFormOptions('P1')
    expect(lastCall()[0]).toBe('/api/automations/form-options?project=P1')
  })
})

describe('mutation — method / path / body', () => {
  const payload = {
    name: 'Rule A',
    enabled: true,
    triggers: [{ kind: 'timer' as const, startAt: '2026-01-01T00:00:00.000Z', repeat: { mode: 'once' as const } }],
    actions: [{ kind: 'runTask' as const, mode: 'create' as const, prompt: 'x' }],
  }

  it('createAutomation → POST /api/automations với body payload', async () => {
    await createAutomation(payload as never, 'P1')

    const [url, init] = lastCall()
    expect(url).toBe('/api/automations?project=P1')
    expect(init.method).toBe('POST')
    expect(lastBody()).toEqual(payload)
  })

  it('updateAutomation → PUT /api/automations/:id', async () => {
    await updateAutomation('rule-a', payload as never, 'P1')

    const [url, init] = lastCall()
    expect(url).toBe('/api/automations/rule-a?project=P1')
    expect(init.method).toBe('PUT')
    expect(lastBody()).toEqual(payload)
  })

  it('toggleAutomation → POST /api/automations/:id/toggle với { enabled }', async () => {
    await toggleAutomation('rule-a', false, 'P1')

    const [url, init] = lastCall()
    expect(url).toBe('/api/automations/rule-a/toggle?project=P1')
    expect(init.method).toBe('POST')
    expect(lastBody()).toEqual({ enabled: false })
  })

  it('deleteAutomation → DELETE /api/automations/:id', async () => {
    await deleteAutomation('rule-a', 'P1')

    const [url, init] = lastCall()
    expect(url).toBe('/api/automations/rule-a?project=P1')
    expect(init.method).toBe('DELETE')
  })

  it('runAutomationNow → POST /api/automations/:id/run', async () => {
    await runAutomationNow('rule-a', 'P1')

    const [url, init] = lastCall()
    expect(url).toBe('/api/automations/rule-a/run?project=P1')
    expect(init.method).toBe('POST')
  })

  it('id được encode để ký tự lạ không phá path', async () => {
    await deleteAutomation('a/b', 'P1')

    expect(lastCall()[0]).toBe('/api/automations/a%2Fb?project=P1')
  })
})

describe('lịch sử chạy — limit mặc định', () => {
  it('fetchAutomationRuns mặc định limit=20, override được', async () => {
    await fetchAutomationRuns('rule-a', 'P1')
    expect(lastCall()[0]).toBe('/api/automations/rule-a/runs?project=P1&limit=20')

    await fetchAutomationRuns('rule-a', 'P1', 5)
    expect(lastCall()[0]).toBe('/api/automations/rule-a/runs?project=P1&limit=5')
  })

  it('fetchAllAutomationRuns mặc định limit=50', async () => {
    await fetchAllAutomationRuns('P1')

    expect(lastCall()[0]).toBe('/api/automations/runs?project=P1&limit=50')
  })
})

describe('lỗi trả về dùng được cho UI', () => {
  it('4xx có body { error } → Error mang message của server + status', async () => {
    mockJson({ error: 'invalid automation id' }, 400)

    await expect(createAutomation({} as never, 'P1')).rejects.toMatchObject({
      message: 'invalid automation id',
      status: 400,
    })
  })

  it('5xx body không phải JSON → Error có message mô tả method/path/status', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>500</html>', { status: 500 }))

    await expect(fetchAutomations('P1')).rejects.toMatchObject({
      message: 'GET /api/automations → 500',
      status: 500,
    })
  })

  it('lỗi mạng (fetch reject) → Error gốc nổi lên, không trả undefined', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(fetchAutomations('P1')).rejects.toThrow('Failed to fetch')
  })
})
