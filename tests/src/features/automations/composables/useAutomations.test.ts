import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

vi.mock('@/features/automations/scripts/automationsApi', () => ({
  fetchAutomations: vi.fn(),
  fetchAutomationEventTypes: vi.fn(),
  fetchAutomationFormOptions: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  toggleAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  runAutomationNow: vi.fn(),
  fetchAllAutomationRuns: vi.fn(),
}))

import {
  createAutomation,
  deleteAutomation,
  fetchAllAutomationRuns,
  fetchAutomationEventTypes,
  fetchAutomationFormOptions,
  fetchAutomations,
  runAutomationNow,
  toggleAutomation,
  updateAutomation,
} from '@/features/automations/scripts/automationsApi'
import { useAutomations } from '@/features/automations/composables/useAutomations'

/**
 * Trạng thái danh sách rule ở FE (TC-31) — quan sát qua state công khai của
 * composable: cờ loading tắt cả khi lỗi, lỗi được xoá khi lần gọi sau thành
 * công, và mọi mutation đều refetch danh sách để UI không hiển thị dữ liệu cũ.
 */

const api = {
  list: vi.mocked(fetchAutomations),
  eventTypes: vi.mocked(fetchAutomationEventTypes),
  formOptions: vi.mocked(fetchAutomationFormOptions),
  create: vi.mocked(createAutomation),
  update: vi.mocked(updateAutomation),
  toggle: vi.mocked(toggleAutomation),
  remove: vi.mocked(deleteAutomation),
  runNow: vi.mocked(runAutomationNow),
  runs: vi.mocked(fetchAllAutomationRuns),
}

const mounted: VueWrapper[] = []

/**
 * Chạy composable trong một component thật: `useAutomations` gọi `onUnmounted`
 * nên gọi trần ngoài setup() sẽ chỉ cảnh báo rồi bỏ qua hook — mount thật cho
 * vòng đời (kể cả stopPolling khi unmount) đúng như lúc panel dùng.
 */
function makeAutomations(getProjectId: () => string | undefined) {
  let api!: ReturnType<typeof useAutomations>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useAutomations(getProjectId)
        return () => h('div')
      },
    }),
  )
  mounted.push(wrapper)
  return api
}

function rule(id: string, over: Record<string, unknown> = {}) {
  return {
    version: 1,
    id,
    name: id.toUpperCase(),
    enabled: true,
    triggers: [],
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: { lastRunAt: null, lastOutcome: null, triggerFired: {}, inFlight: false },
    nextRunAt: null,
    ...over,
  }
}

beforeEach(() => {
  api.list.mockResolvedValue({ automations: [] } as never)
  api.eventTypes.mockResolvedValue({ types: [] } as never)
  api.formOptions.mockResolvedValue({ tasks: [], profiles: [], runners: [], projects: [] } as never)
  api.runs.mockResolvedValue({ runs: [] } as never)
  api.create.mockResolvedValue({} as never)
  api.update.mockResolvedValue({} as never)
  api.toggle.mockResolvedValue({} as never)
  api.remove.mockResolvedValue({} as never)
  api.runNow.mockResolvedValue({ run: { runId: 'run-1' } } as never)
})

afterEach(() => {
  // Unmount trước khi trả đồng hồ thật: onUnmounted(stopPolling) phải dọn timer
  // của case này, không để rò sang case sau.
  while (mounted.length) mounted.pop()!.unmount()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('load()', () => {
  it('set danh sách (đã sort theo tên), tắt loading, clear error', async () => {
    api.list.mockResolvedValue({ automations: [rule('zulu'), rule('alpha')] } as never)
    const a = makeAutomations(() => 'P1')

    await a.load()

    expect(api.list).toHaveBeenCalledWith('P1')
    expect(a.automations.value.map((r) => r.id)).toEqual(['alpha', 'zulu'])
    expect(a.loading.value).toBe(false)
    expect(a.error.value).toBe('')
  })

  it('API trả automations undefined → danh sách rỗng, không throw', async () => {
    api.list.mockResolvedValue({} as never)
    const a = makeAutomations(() => 'P1')

    await a.load()

    expect(a.automations.value).toEqual([])
  })

  it('API lỗi → error được set, loading vẫn tắt, danh sách cũ KHÔNG bị xoá trắng', async () => {
    api.list.mockResolvedValue({ automations: [rule('alpha')] } as never)
    const a = makeAutomations(() => 'P1')
    await a.load()

    api.list.mockRejectedValue(new Error('mất mạng'))
    await a.load()

    expect(a.error.value).toContain('mất mạng')
    expect(a.loading.value).toBe(false)
    expect(a.automations.value.map((r) => r.id)).toEqual(['alpha'])
  })

  it('lần load kế tiếp thành công thì error được xoá', async () => {
    // Mount đã kéo một lần load (watch immediate) — chỉ set lỗi sau đó để case
    // đo đúng lần load do test gọi.
    const a = makeAutomations(() => 'P1')
    api.list.mockRejectedValue(new Error('lỗi tạm'))
    await a.load()
    expect(a.error.value).toContain('lỗi tạm')

    api.list.mockResolvedValue({ automations: [] } as never)
    await a.load()

    expect(a.error.value).toBe('')
  })
})

describe('mutation — gọi đúng API rồi refetch danh sách', () => {
  it('create() gọi createAutomation với projectId rồi load lại, trả true', async () => {
    const a = makeAutomations(() => 'P1')
    api.list.mockClear()

    const ok = await a.create({ name: 'Rule A' } as never)

    expect(ok).toBe(true)
    expect(api.create).toHaveBeenCalledWith({ name: 'Rule A' }, 'P1')
    expect(api.list).toHaveBeenCalledTimes(1)
  })

  it('update() gọi updateAutomation với id + projectId rồi load lại', async () => {
    const a = makeAutomations(() => 'P1')
    api.list.mockClear()

    const ok = await a.update('rule-a', { name: 'Rule B' } as never)

    expect(ok).toBe(true)
    expect(api.update).toHaveBeenCalledWith('rule-a', { name: 'Rule B' }, 'P1')
    expect(api.list).toHaveBeenCalledTimes(1)
  })

  it('toggle() gọi toggleAutomation với giá trị mới rồi load lại', async () => {
    const a = makeAutomations(() => 'P1')
    api.list.mockClear()

    await a.toggle('rule-a', false)

    expect(api.toggle).toHaveBeenCalledWith('rule-a', false, 'P1')
    expect(api.list).toHaveBeenCalledTimes(1)
  })

  it('remove() gọi deleteAutomation rồi load lại', async () => {
    const a = makeAutomations(() => 'P1')
    api.list.mockClear()

    await a.remove('rule-a')

    expect(api.remove).toHaveBeenCalledWith('rule-a', 'P1')
    expect(api.list).toHaveBeenCalledTimes(1)
  })

  it('create/update lỗi → actionError được set, trả false (không throw ra UI)', async () => {
    api.create.mockRejectedValue(new Error('invalid request'))
    api.update.mockRejectedValue(new Error('automation not found'))
    const a = makeAutomations(() => 'P1')

    expect(await a.create({} as never)).toBe(false)
    expect(a.actionError.value).toContain('invalid request')

    expect(await a.update('rule-a', {} as never)).toBe(false)
    expect(a.actionError.value).toContain('automation not found')
  })

  it('actionError được xoá ở lần mutation kế tiếp', async () => {
    api.toggle.mockRejectedValueOnce(new Error('lỗi tạm'))
    const a = makeAutomations(() => 'P1')
    await a.toggle('rule-a', false)
    expect(a.actionError.value).toContain('lỗi tạm')

    await a.toggle('rule-a', true)

    expect(a.actionError.value).toBe('')
  })
})

describe('runNow()', () => {
  it('đánh dấu rule đang chạy trong lúc chờ, bỏ dấu khi xong, refetch list + history', async () => {
    let release: (v: unknown) => void = () => {}
    api.runNow.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }) as never,
    )
    const a = makeAutomations(() => 'P1')
    api.list.mockClear()
    api.runs.mockClear()

    const pending = a.runNow('rule-a')
    expect(a.runningIds.value.has('rule-a')).toBe(true)

    release({ run: { runId: 'run-1' } })
    const run = await pending

    expect(run).toEqual({ runId: 'run-1' })
    expect(a.runningIds.value.has('rule-a')).toBe(false)
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(api.runs).toHaveBeenCalledTimes(1)
  })

  it('lỗi → trả null, actionError được set, rule không còn bị treo trạng thái đang chạy', async () => {
    api.runNow.mockRejectedValue(new Error('automation not found'))
    const a = makeAutomations(() => 'P1')

    expect(await a.runNow('rule-a')).toBeNull()
    expect(a.actionError.value).toContain('automation not found')
    expect(a.runningIds.value.has('rule-a')).toBe(false)
  })
})

describe('loadRuns() / loadEventTypes() / loadFormOptions()', () => {
  it('loadRuns lấy 50 bản gần nhất; lỗi → danh sách rỗng, runsLoading tắt', async () => {
    api.runs.mockResolvedValue({ runs: [{ runId: 'run-1' }] } as never)
    const a = makeAutomations(() => 'P1')

    await a.loadRuns()
    expect(api.runs).toHaveBeenCalledWith('P1', 50)
    expect(a.runs.value).toEqual([{ runId: 'run-1' }])

    api.runs.mockRejectedValue(new Error('lỗi'))
    await a.loadRuns()
    expect(a.runs.value).toEqual([])
    expect(a.runsLoading.value).toBe(false)
  })

  it('loadEventTypes chỉ gọi API một lần (đã có thì không gọi lại)', async () => {
    api.eventTypes.mockResolvedValue({ types: ['job.failed'] } as never)
    const a = makeAutomations(() => 'P1')
    await a.loadEventTypes()
    api.eventTypes.mockClear()

    await a.loadEventTypes()

    expect(api.eventTypes).not.toHaveBeenCalled()
    expect(a.eventTypes.value).toEqual(['job.failed'])
  })

  it('loadFormOptions lỗi → options rỗng chứ không giữ giá trị lỗi', async () => {
    api.formOptions.mockRejectedValue(new Error('registry hỏng'))
    const a = makeAutomations(() => 'P1')

    await a.loadFormOptions()

    expect(a.formOptions.value).toEqual({ tasks: [], profiles: [], runners: [], projects: [] })
  })
})

describe('scope theo project', () => {
  it('getProjectId() trả undefined → vẫn gọi được (scope mặc định), không throw', async () => {
    const a = makeAutomations(() => undefined)

    await a.load()

    expect(api.list).toHaveBeenCalledWith(undefined)
    expect(a.error.value).toBe('')
  })

  it('đổi projectId → lần load kế tiếp dùng id mới', async () => {
    const projectId = ref<string | undefined>('P1')
    const a = makeAutomations(() => projectId.value)
    await a.load()
    expect(api.list).toHaveBeenLastCalledWith('P1')

    projectId.value = 'P2'
    await a.load()

    expect(api.list).toHaveBeenLastCalledWith('P2')
  })
})

describe('polling', () => {
  it('startPolling refetch theo chu kỳ; stopPolling dừng hẳn', async () => {
    vi.useFakeTimers()
    const a = makeAutomations(() => 'P1')
    await vi.advanceTimersByTimeAsync(0)
    api.list.mockClear()

    a.startPolling()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.list).toHaveBeenCalledTimes(1)

    a.stopPolling()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.list).toHaveBeenCalledTimes(1)
  })

  it('startPolling gọi hai lần không tạo hai vòng poll song song', async () => {
    vi.useFakeTimers()
    const a = makeAutomations(() => 'P1')
    await vi.advanceTimersByTimeAsync(0)
    api.list.mockClear()

    a.startPolling()
    a.startPolling()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(api.list).toHaveBeenCalledTimes(1)
    a.stopPolling()
  })
})

/**
 * Options theo project đích (T0d57ff58).
 *
 * Một bước action có thể trỏ project khác, nên combobox task/profile/runner của
 * bước đó phải gợi ý dữ liệu của **project đó** — gợi ý nhầm project còn tệ hơn
 * không gợi ý, vì người dùng chọn từ dropdown rồi mới fail lúc chạy.
 */
describe('ensureFormOptions — options của project đích', () => {
  const OPTIONS_B = { tasks: ['TB1'], profiles: ['pb'], runners: [], projects: [] }

  it('nạp options của project đích và cache theo id', async () => {
    const a = makeAutomations(() => 'P1')
    api.formOptions.mockResolvedValue(OPTIONS_B as never)

    await a.ensureFormOptions('proj-b-1a2b3c4d')

    expect(api.formOptions).toHaveBeenLastCalledWith('proj-b-1a2b3c4d')
    expect(a.optionsByProject.value['proj-b-1a2b3c4d']).toEqual(OPTIONS_B)
  })

  it('gọi lần hai cho cùng project không fetch lại', async () => {
    const a = makeAutomations(() => 'P1')
    api.formOptions.mockResolvedValue(OPTIONS_B as never)
    await a.ensureFormOptions('proj-b-1a2b3c4d')
    api.formOptions.mockClear()

    await a.ensureFormOptions('proj-b-1a2b3c4d')

    expect(api.formOptions).not.toHaveBeenCalled()
  })

  it('id rỗng → không fetch (rỗng nghĩa là project đang chọn)', async () => {
    const a = makeAutomations(() => 'P1')
    api.formOptions.mockClear()

    await a.ensureFormOptions('   ')

    expect(api.formOptions).not.toHaveBeenCalled()
  })

  it('options của project đích không đè lên formOptions của project đang chọn', async () => {
    const a = makeAutomations(() => 'P1')
    api.formOptions.mockResolvedValue({ tasks: ['TA1'], profiles: [], runners: [], projects: [] } as never)
    await a.loadFormOptions()
    api.formOptions.mockResolvedValue(OPTIONS_B as never)

    await a.ensureFormOptions('proj-b-1a2b3c4d')

    expect(a.formOptions.value.tasks).toEqual(['TA1'])
    expect(a.optionsByProject.value['proj-b-1a2b3c4d'].tasks).toEqual(['TB1'])
  })

  it('lỗi khi nạp project đích → options rỗng, không giữ giá trị của project khác', async () => {
    const a = makeAutomations(() => 'P1')
    api.formOptions.mockRejectedValue(new Error('registry hỏng'))

    await a.ensureFormOptions('proj-b-1a2b3c4d')

    expect(a.optionsByProject.value['proj-b-1a2b3c4d']).toEqual({
      tasks: [],
      profiles: [],
      runners: [],
      projects: [],
    })
  })

  it('đổi project đang chọn → cache options cũ bị xoá', async () => {
    const projectId = ref<string | undefined>('P1')
    const a = makeAutomations(() => projectId.value)
    api.formOptions.mockResolvedValue(OPTIONS_B as never)
    await a.ensureFormOptions('proj-b-1a2b3c4d')
    expect(a.optionsByProject.value['proj-b-1a2b3c4d']).toBeTruthy()

    projectId.value = 'P2'
    await nextTick()

    expect(a.optionsByProject.value['proj-b-1a2b3c4d']).toBeUndefined()
  })
})
