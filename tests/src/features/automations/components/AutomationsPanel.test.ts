import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

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
  deleteAutomation,
  fetchAllAutomationRuns,
  fetchAutomationEventTypes,
  fetchAutomationFormOptions,
  fetchAutomations,
  runAutomationNow,
  toggleAutomation,
} from '@/features/automations/scripts/automationsApi'
import AutomationsPanel from '@/features/automations/components/AutomationsPanel.vue'
import { mountWithI18n } from '../../../helpers/i18n'

/**
 * Panel Automations (TC-32) — mount thật, chỉ giả lập lớp API. Điểm nhìn:
 * người dùng thấy đủ rule (phân biệt bật/tắt), có lối vào chạy-ngay / sửa /
 * xoá, danh sách rỗng hiện hướng dẫn chứ không hiện lỗi, và API lỗi hiện thông
 * báo đọc được chứ không màn hình trắng.
 *
 * Form tạo/sửa rule ngoài phạm vi (design.md §6) — chỉ kiểm dialog mở được.
 */

const api = {
  list: vi.mocked(fetchAutomations),
  eventTypes: vi.mocked(fetchAutomationEventTypes),
  formOptions: vi.mocked(fetchAutomationFormOptions),
  toggle: vi.mocked(toggleAutomation),
  remove: vi.mocked(deleteAutomation),
  runNow: vi.mocked(runAutomationNow),
  runs: vi.mocked(fetchAllAutomationRuns),
}

function rule(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: 'rule-a',
    name: 'Rule A',
    enabled: true,
    triggers: [{ id: 't1', kind: 'timer', startAt: '2026-01-01T00:00:00.000Z', repeat: { mode: 'once' } }],
    actions: [{ kind: 'runTask', mode: 'create', prompt: 'x' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: { lastRunAt: null, lastOutcome: null, triggerFired: {}, inFlight: false },
    nextRunAt: '2026-06-01T00:00:00.000Z',
    ...over,
  }
}

async function mountPanel() {
  const wrapper = mountWithI18n(AutomationsPanel, { props: { projectId: 'P1' } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  api.list.mockResolvedValue({ automations: [] } as never)
  api.eventTypes.mockResolvedValue({ types: ['job.failed'] } as never)
  api.formOptions.mockResolvedValue({ tasks: [], profiles: [], runners: [], projects: [] } as never)
  api.runs.mockResolvedValue({ runs: [] } as never)
  api.toggle.mockResolvedValue({} as never)
  api.remove.mockResolvedValue({} as never)
  api.runNow.mockResolvedValue({ run: { runId: 'run-1' } } as never)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('danh sách rule', () => {
  it('render tên, trạng thái bật/tắt, lịch chạy kế và các nút hành động', async () => {
    api.list.mockResolvedValue({
      automations: [rule(), rule({ id: 'rule-b', name: 'Rule B', enabled: false })],
    } as never)

    const wrapper = await mountPanel()

    const rows = wrapper.findAll('.rule-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.rule-name').text()).toBe('Rule A')
    expect(rows[0].find('.rule-status-chip').text()).toBe('Đang bật')
    expect(rows[0].classes()).not.toContain('disabled')
    // Rule tắt phân biệt được cả bằng chip và bằng class hàng.
    expect(rows[1].find('.rule-status-chip').text()).toBe('Đang tắt')
    expect(rows[1].classes()).toContain('disabled')
    expect(rows[0].text()).toContain('Chạy kế')
    for (const title of ['Tắt automation', 'Chạy thử ngay', 'Lịch sử chạy', 'Sửa automation', 'Xoá automation']) {
      expect(rows[0].find(`button[title="${title}"]`).exists()).toBe(true)
    }
  })

  it('rule đang chạy hiện chip "Đang chạy…"', async () => {
    api.list.mockResolvedValue({
      automations: [rule({ state: { lastRunAt: null, lastOutcome: null, triggerFired: {}, inFlight: true } })],
    } as never)

    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Đang chạy…')
  })

  it('rule có lần chạy trước hiện thời điểm + kết quả', async () => {
    api.list.mockResolvedValue({
      automations: [
        rule({
          state: {
            lastRunAt: '2026-05-05T05:05:00.000Z',
            lastOutcome: 'succeeded',
            triggerFired: {},
            inFlight: false,
          },
        }),
      ],
    } as never)

    const wrapper = await mountPanel()

    expect(wrapper.find('.rule-last-run').text()).toContain('Chạy gần nhất')
  })

  it('danh sách rỗng → empty state có hướng dẫn, không hiện lỗi', async () => {
    const wrapper = await mountPanel()

    const empty = wrapper.find('.panel-empty')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('Chưa có automation nào')
    expect(wrapper.find('.panel-error').exists()).toBe(false)
    expect(wrapper.find('.rule-row').exists()).toBe(false)
  })
})

describe('thao tác trên rule', () => {
  it('bấm toggle gọi API với giá trị đảo lại của rule', async () => {
    api.list.mockResolvedValue({ automations: [rule()] } as never)
    const wrapper = await mountPanel()

    await wrapper.find('button[title="Tắt automation"]').trigger('click')
    await flushPromises()

    expect(api.toggle).toHaveBeenCalledWith('rule-a', false, 'P1')
  })

  it('bấm "Chạy thử ngay" gọi run-now rồi chuyển sang tab lịch sử', async () => {
    api.list.mockResolvedValue({ automations: [rule()] } as never)
    const wrapper = await mountPanel()

    await wrapper.find('button[title="Chạy thử ngay"]').trigger('click')
    await flushPromises()

    expect(api.runNow).toHaveBeenCalledWith('rule-a', 'P1')
    // Chuỗi action chạy nền → panel mở tab lịch sử để theo dõi.
    expect(wrapper.find('.history-toolbar').exists()).toBe(true)
  })

  it('nút chạy bị disable trong lúc run-now chưa trả về', async () => {
    api.list.mockResolvedValue({ automations: [rule()] } as never)
    let release: (v: unknown) => void = () => {}
    api.runNow.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }) as never,
    )
    const wrapper = await mountPanel()

    await wrapper.find('button[title="Chạy thử ngay"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button[title="Chạy thử ngay"]').attributes('disabled')).toBeDefined()

    release({ run: { runId: 'run-1' } })
    await flushPromises()
  })

  it('bấm xoá: xác nhận thì gọi API, huỷ xác nhận thì không', async () => {
    api.list.mockResolvedValue({ automations: [rule()] } as never)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountPanel()

    await wrapper.find('button[title="Xoá automation"]').trigger('click')
    await flushPromises()
    expect(api.remove).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    await wrapper.find('button[title="Xoá automation"]').trigger('click')
    await flushPromises()
    expect(api.remove).toHaveBeenCalledWith('rule-a', 'P1')
  })

  it('bấm "Làm mới" gọi lại API danh sách', async () => {
    const wrapper = await mountPanel()
    api.list.mockClear()

    await wrapper.find('button[title="Làm mới"]').trigger('click')
    await flushPromises()

    expect(api.list).toHaveBeenCalledTimes(1)
  })
})

describe('dialog tạo/sửa rule', () => {
  it('bấm "Tạo automation" mở dialog và nạp options cho combobox', async () => {
    const wrapper = await mountPanel()
    expect(wrapper.find('.automation-form').exists()).toBe(false)

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.find('.automation-form').exists()).toBe(true)
    expect(api.formOptions).toHaveBeenCalledWith('P1')
  })

  it('bấm "Sửa automation" mở dialog cho rule đang chọn', async () => {
    api.list.mockResolvedValue({ automations: [rule()] } as never)
    const wrapper = await mountPanel()

    await wrapper.find('button[title="Sửa automation"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.automation-form').exists()).toBe(true)
  })
})

describe('tab lịch sử thực thi', () => {
  it('hiện các lần chạy với kết quả; rỗng thì hiện thông báo rỗng', async () => {
    api.list.mockResolvedValue({ automations: [rule()] } as never)
    api.runs.mockResolvedValue({
      runs: [
        {
          version: 1,
          runId: 'run-1',
          automationId: 'rule-a',
          projectId: 'P1',
          source: 'manual',
          triggerId: 'manual',
          triggerKind: 'manual',
          startedAt: '2026-05-05T05:05:00.000Z',
          finishedAt: '2026-05-05T05:06:00.000Z',
          outcome: 'succeeded',
        },
      ],
    } as never)
    const wrapper = await mountPanel()

    await wrapper.findAll('.panel-tab')[1].trigger('click')
    await flushPromises()

    const runRows = wrapper.findAll('.run-row')
    expect(runRows).toHaveLength(1)
    expect(runRows[0].text()).toContain('Rule A')
    expect(runRows[0].find('.outcome-succeeded').exists()).toBe(true)
  })

  it('bấm một lần chạy thì bung chi tiết bước', async () => {
    api.list.mockResolvedValue({ automations: [rule()] } as never)
    api.runs.mockResolvedValue({
      runs: [
        {
          version: 1,
          runId: 'run-1',
          automationId: 'rule-a',
          projectId: 'P1',
          source: 'schedule',
          triggerId: 't1',
          triggerKind: 'timer',
          startedAt: '2026-05-05T05:05:00.000Z',
          finishedAt: '2026-05-05T05:06:00.000Z',
          outcome: 'failed',
          error: 'task không tồn tại',
          steps: [{ index: 1, name: 'Bước 1', status: 'failed', error: 'task không tồn tại' }],
        },
      ],
    } as never)
    const wrapper = await mountPanel()
    await wrapper.findAll('.panel-tab')[1].trigger('click')
    await flushPromises()

    await wrapper.find('.run-row').trigger('click')

    const detail = wrapper.find('.run-detail-row')
    expect(detail.exists()).toBe(true)
    expect(detail.text()).toContain('task không tồn tại')
    expect(detail.text()).toContain('Bước 1')
  })
})

describe('lỗi API', () => {
  it('load danh sách lỗi → hiện thông báo lỗi đọc được, panel vẫn render', async () => {
    api.list.mockRejectedValue(new Error('mất mạng'))

    const wrapper = await mountPanel()

    const error = wrapper.find('.panel-error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('Không tải được danh sách automation')
    expect(error.text()).toContain('mất mạng')
    expect(wrapper.find('.automations-panel').exists()).toBe(true)
  })

  it('lỗi lịch sử chạy không làm sập panel', async () => {
    api.list.mockResolvedValue({ automations: [rule()] } as never)
    api.runs.mockRejectedValue(new Error('lỗi đọc history'))

    const wrapper = await mountPanel()
    await wrapper.findAll('.panel-tab')[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.rule-table').exists()).toBe(true)
    expect(wrapper.findAll('.run-row')).toHaveLength(0)
  })
})

/**
 * Badge project đích trong cột "Các bước" (T0d57ff58).
 *
 * Rule sống ở project đang chọn nhưng một bước có thể chạy ở project khác —
 * không nói ra thì người đọc mặc định hiểu sai là task nằm ở project này.
 */
describe('cột "Các bước" — project đích của action runTask', () => {
  const PROJECTS = [
    { id: 'proj-b-1a2b3c4d', name: 'Project B', default: false },
    { id: 'proj-c-5e6f7a8b', name: 'Project C', default: true },
  ]

  it('action có project đích → hiện tên project bên cạnh tên bước', async () => {
    api.formOptions.mockResolvedValue({ tasks: [], profiles: [], runners: [], projects: PROJECTS } as never)
    api.list.mockResolvedValue({
      automations: [rule({ actions: [{ kind: 'runTask', mode: 'create', prompt: 'x', projectId: 'proj-b-1a2b3c4d' }] })],
    } as never)

    const wrapper = await mountPanel()

    expect(wrapper.find('.rule-steps').text()).toContain('Project B')
  })

  it('project đích chưa có trong danh sách (đã bị gỡ khỏi registry) → hiện thẳng id', async () => {
    api.formOptions.mockResolvedValue({ tasks: [], profiles: [], runners: [], projects: PROJECTS } as never)
    api.list.mockResolvedValue({
      automations: [rule({ actions: [{ kind: 'runTask', mode: 'create', prompt: 'x', projectId: 'da-bi-go' }] })],
    } as never)

    const wrapper = await mountPanel()

    expect(wrapper.find('.rule-steps').text()).toContain('da-bi-go')
  })

  it('không chọn project đích → nhãn bước không đổi, không có mũi tên thừa', async () => {
    api.formOptions.mockResolvedValue({ tasks: [], profiles: [], runners: [], projects: PROJECTS } as never)
    api.list.mockResolvedValue({ automations: [rule()] } as never)

    const wrapper = await mountPanel()

    const steps = wrapper.find('.rule-steps').text()
    expect(steps).toContain('Tạo task mới')
    expect(steps).not.toContain('→')
  })
})
