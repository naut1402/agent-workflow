import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTaskPolling } from '@/features/monitor/composables/useTaskPolling'

function stubTasks(payload: any) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useTaskPolling', () => {
  it('poll() populates state and auto-selects a task needing attention', async () => {
    stubTasks({ root: '/r', tasks: [{ task_id: 'A' }, { task_id: 'B', hitl_pending: 'hitl-2' }] })
    const p = useTaskPolling(() => null)
    await p.poll()
    expect(p.root.value).toBe('/r')
    expect(p.tasks.value.length).toBe(2)
    expect(p.connected.value).toBe(true)
    expect(p.selectedId.value).toBe('B') // prefers the one needing attention
  })

  it('keeps an existing selection on subsequent polls', async () => {
    stubTasks({ root: '/r', tasks: [{ task_id: 'A' }] })
    const p = useTaskPolling(() => null)
    p.selectedId.value = 'X'
    await p.poll()
    expect(p.selectedId.value).toBe('X')
  })

  it('poll() marks disconnected on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    const p = useTaskPolling(() => null)
    await p.poll()
    expect(p.connected.value).toBe(false)
    expect(p.error.value).toContain('boom')
  })

  it('start() polls immediately then on the interval; stop() halts it', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ root: '/r', tasks: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const p = useTaskPolling(() => null, 1500)

    p.start()
    await vi.advanceTimersByTimeAsync(0) // flush the immediate poll
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1500)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    p.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchMock).toHaveBeenCalledTimes(2) // no more polls after stop
  })
})
