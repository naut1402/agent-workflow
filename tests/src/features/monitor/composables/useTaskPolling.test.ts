import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTaskPolling } from '@/features/monitor/composables/useTaskPolling'
import { makeSseStream } from '../../../helpers/sseStream'

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
    expect(p.selectedId.value).toBe('B') // prefers the one needing attention
  })

  it('keeps an existing selection on subsequent polls', async () => {
    stubTasks({ root: '/r', tasks: [{ task_id: 'A' }] })
    const p = useTaskPolling(() => null)
    p.selectedId.value = 'X'
    await p.poll()
    expect(p.selectedId.value).toBe('X')
  })

  it('fallback skips a finished task at the front of the array and selects the first candidate still open', async () => {
    stubTasks({
      root: '/r',
      tasks: [
        { task_id: 'A', current_phase: 'completed' },
        { task_id: 'B', archived: true },
        { task_id: 'C' },
      ],
    })
    const p = useTaskPolling(() => null)
    await p.poll()
    expect(p.selectedId.value).toBe('C')
  })

  it('selects nothing when every task is finished', async () => {
    stubTasks({
      root: '/r',
      tasks: [
        { task_id: 'A', current_phase: 'completed' },
        { task_id: 'B', archived: true },
      ],
    })
    const p = useTaskPolling(() => null)
    await p.poll()
    expect(p.selectedId.value).toBeNull()
  })

  it('keeps the previous behavior when the first task is already open', async () => {
    stubTasks({ root: '/r', tasks: [{ task_id: 'A' }, { task_id: 'B', current_phase: 'completed' }] })
    const p = useTaskPolling(() => null)
    await p.poll()
    expect(p.selectedId.value).toBe('A')
  })

  it('a task needing attention still wins even when it is also archived', async () => {
    stubTasks({
      root: '/r',
      tasks: [
        { task_id: 'A', archived: true, has_qa: true },
        { task_id: 'B' },
      ],
    })
    const p = useTaskPolling(() => null)
    await p.poll()
    expect(p.selectedId.value).toBe('A')
  })

  it('does not auto-select an archived task after switching project resets the selection', async () => {
    stubTasks({ root: '/r', tasks: [{ task_id: 'X' }] })
    const p = useTaskPolling(() => null)
    await p.poll()
    expect(p.selectedId.value).toBe('X')

    p.selectedId.value = null
    stubTasks({
      root: '/r2',
      tasks: [
        { task_id: 'A', current_phase: 'completed' },
        { task_id: 'B', archived: true },
      ],
    })
    await p.poll()
    expect(p.selectedId.value).toBeNull()
  })

  it('poll() records the error on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    const p = useTaskPolling(() => null)
    await p.poll()
    expect(p.error.value).toContain('boom')
  })

  it('start() opens the SSE stream, applies the snapshot and marks connected', async () => {
    const sse = makeSseStream()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, body: sse.stream }))
    vi.stubGlobal('fetch', fetchMock)
    const p = useTaskPolling(() => 'proj-1')

    p.start()
    await vi.waitUntil(() => p.connected.value === true)
    const [input] = fetchMock.mock.calls[0]!
    expect(String(input)).toContain('/api/tasks/stream')
    expect(String(input)).toContain('project=proj-1')

    sse.push('tasks', { root: '/r', tasks: [{ task_id: 'A' }, { task_id: 'B', hitl_pending: 'x' }] })
    await vi.waitUntil(() => p.tasks.value.length > 0)
    expect(p.root.value).toBe('/r')
    expect(p.selectedId.value).toBe('B')

    p.stop()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a second task update overwrites only what changed, other tasks keep their fields', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: sse.stream })))
    const p = useTaskPolling(() => null)

    p.start()
    sse.push('tasks', { root: '/r', tasks: [{ task_id: 'A', status: 'running' }, { task_id: 'B', status: 'running' }] })
    await vi.waitUntil(() => p.tasks.value.length === 2)

    sse.push('tasks', { root: '/r', tasks: [{ task_id: 'A', status: 'done' }, { task_id: 'B', status: 'running' }] })
    await vi.waitUntil(() => p.tasks.value.find((t: any) => t.task_id === 'A')?.status === 'done')
    expect(p.tasks.value.find((t: any) => t.task_id === 'B')?.status).toBe('running')

    p.stop()
  })

  it('ignores frames of an unrelated event type', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: sse.stream })))
    const p = useTaskPolling(() => null)

    p.start()
    sse.push('jobs', { jobs: [] })
    await new Promise((r) => setTimeout(r, 10))
    expect(p.tasks.value).toEqual([])
    expect(p.root.value).toBe('')

    p.stop()
  })

  it('stop() closes the stream so a later frame is not applied', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: sse.stream })))
    const p = useTaskPolling(() => null)

    p.start()
    sse.push('tasks', { root: '/r', tasks: [{ task_id: 'A' }] })
    await vi.waitUntil(() => p.tasks.value.length === 1)

    p.stop()
    expect(p.connected.value).toBe(false)
  })
})
