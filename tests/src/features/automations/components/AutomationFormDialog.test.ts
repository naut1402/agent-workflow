import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AutomationFormDialog from '@/features/automations/components/AutomationFormDialog.vue'
import type { AutomationFormOptions } from '@/features/automations/scripts/automationsApi'
import { createTestI18nPlugin } from '../../../helpers/i18n'

/**
 * Combobox "Project đích" của action `runTask` (T0d57ff58).
 *
 * Điểm nhìn người dùng: chọn được project cho từng bước, để trống nghĩa là
 * project đang chọn, và gợi ý task/profile/runner phải là dữ liệu của **project
 * đích của chính bước đó** — gợi ý nhầm project còn tệ hơn không gợi ý vì người
 * dùng chọn từ dropdown rồi mới fail lúc chạy.
 */

const PROJ_B = 'proj-b-1a2b3c4d'

const CURRENT_OPTIONS: AutomationFormOptions = {
  tasks: ['TASK-A'],
  profiles: ['profile-a'],
  runners: [{ id: 'runner-a', label: 'Runner A' }],
  projects: [
    { id: PROJ_B, name: 'Project B', default: false },
    { id: 'proj-c-5e6f7a8b', name: 'Project C', default: true },
  ],
}

const OPTIONS_B: AutomationFormOptions = {
  tasks: ['TASK-B'],
  profiles: ['profile-b'],
  runners: [{ id: 'runner-b', label: 'Runner B' }],
  projects: CURRENT_OPTIONS.projects,
}

/** Dialog mount vào document.body (combobox cần focus thật) — dọn ở afterEach. */
const mounted: ReturnType<typeof mount>[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

function mountDialog(props: Record<string, unknown> = {}, locale: 'vi' | 'en' = 'vi') {
  const wrapper = mount(AutomationFormDialog, {
    props: {
      visible: true,
      editRule: null,
      eventTypes: ['job.failed'],
      formOptions: CURRENT_OPTIONS,
      optionsByProject: {},
      saving: false,
      serverError: '',
      ...props,
    },
    attachTo: document.body,
    global: { plugins: [createTestI18nPlugin(locale)] },
  })
  mounted.push(wrapper)
  return wrapper
}

/** Combobox theo aria-label — nhãn là thứ người dùng thấy, không phải class nội bộ. */
function comboByLabel(wrapper: ReturnType<typeof mountDialog>, label: string) {
  return wrapper.findAll('input[role="combobox"]').filter((i) => i.attributes('aria-label') === label)
}

async function addRunTaskAction(wrapper: ReturnType<typeof mountDialog>) {
  const addBtn = wrapper.findAll('button').find((b) => b.text().includes('Thêm bước'))!
  await addBtn.trigger('click')
  await flushPromises()
}

/** Mở panel rồi click option theo nhãn — đúng thao tác người dùng làm. */
async function pickOption(input: ReturnType<typeof comboByLabel>[number], label: string) {
  await input.trigger('focus')
  const menu = input.element.closest('.c-combo-select')!.querySelector('.c-select-menu')!
  const option = [...menu.querySelectorAll('.c-select-option')].find((o) => o.textContent?.trim() === label)!
  option.dispatchEvent(new Event('click', { bubbles: true }))
  await flushPromises()
}

function ruleWith(actions: Record<string, unknown>[]) {
  return {
    version: 1,
    id: 'rule-a',
    name: 'Rule A',
    enabled: true,
    description: '',
    triggers: [{ id: 't1', kind: 'event', eventType: 'job.failed' }],
    actions,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: { lastRunAt: null, lastOutcome: null, triggerFired: {}, inFlight: false },
    nextRunAt: null,
  } as never
}

describe('control "Project đích"', () => {
  it('hiện ở mode create, mặc định trống kèm gợi ý "project đang chọn"', async () => {
    const wrapper = mountDialog()
    await addRunTaskAction(wrapper)

    const combo = comboByLabel(wrapper, 'Project đích (tuỳ chọn)')
    expect(combo).toHaveLength(1)
    expect((combo[0].element as HTMLInputElement).value).toBe('')
    expect(combo[0].attributes('placeholder')).toBe('Mặc định: project đang chọn')
    expect(wrapper.text()).toContain('Để trống thì bước này chạy trên project đang chọn')
  })

  it('vẫn hiện và giữ giá trị khi đổi sang mode existing', async () => {
    const wrapper = mountDialog()
    await addRunTaskAction(wrapper)
    await pickOption(comboByLabel(wrapper, 'Project đích (tuỳ chọn)')[0], 'Project B')

    const existingRadio = wrapper.findAll('input[type="radio"][value="existing"]')[0]
    await existingRadio.setValue()
    await flushPromises()

    const combo = comboByLabel(wrapper, 'Project đích (tuỳ chọn)')
    expect(combo).toHaveLength(1)
    expect((combo[0].element as HTMLInputElement).value).toBe('Project B')
  })

  it('project mặc định của registry có gắn nhãn "mặc định"', async () => {
    const wrapper = mountDialog()
    await addRunTaskAction(wrapper)
    const combo = comboByLabel(wrapper, 'Project đích (tuỳ chọn)')[0]

    await combo.trigger('focus')

    const labels = [...combo.element.closest('.c-combo-select')!.querySelectorAll('.c-select-option')].map((o) =>
      o.textContent?.trim(),
    )
    expect(labels).toEqual(['Project B', 'Project C (mặc định)'])
  })

  it('chọn project → emit request-options để panel nạp options của project đó', async () => {
    const wrapper = mountDialog()
    await addRunTaskAction(wrapper)

    await pickOption(comboByLabel(wrapper, 'Project đích (tuỳ chọn)')[0], 'Project B')

    expect(wrapper.emitted('request-options')?.at(-1)).toEqual([PROJ_B])
  })

  it('mở sửa rule đã có project đích → hiện nhãn project, không phải id thô', async () => {
    const wrapper = mountDialog({
      editRule: ruleWith([{ kind: 'runTask', mode: 'existing', taskId: 'TASK-B', projectId: PROJ_B }]),
    })
    await flushPromises()

    const combo = comboByLabel(wrapper, 'Project đích (tuỳ chọn)')[0]
    expect((combo.element as HTMLInputElement).value).toBe('Project B')
  })
})

describe('payload khi lưu', () => {
  async function submitForm(wrapper: ReturnType<typeof mountDialog>) {
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'Lưu')!
    await saveBtn.trigger('click')
    await flushPromises()
    return (wrapper.emitted('submit')?.at(-1)?.[0] as { body: { actions: Record<string, unknown>[] } }).body.actions
  }

  it('project đích chỉ gắn vào đúng bước đã chọn', async () => {
    // Prefill từ rule hợp lệ để form qua được validation — case này quan tâm
    // payload của project đích, không phải luật validate trigger/prompt.
    const wrapper = mountDialog({
      editRule: ruleWith([
        { kind: 'runTask', mode: 'create', prompt: 'việc 1' },
        { kind: 'runTask', mode: 'create', prompt: 'việc 2' },
      ]),
    })
    await flushPromises()
    const combos = comboByLabel(wrapper, 'Project đích (tuỳ chọn)')
    expect(combos).toHaveLength(2)

    // Chỉ bước 2 trỏ project khác.
    await pickOption(combos[1], 'Project B')

    const actions = await submitForm(wrapper)

    expect(actions[0].projectId).toBeUndefined()
    expect(actions[1]).toMatchObject({ projectId: PROJ_B })
  })

  it('clear project đích → payload không có khoá projectId (không gửi chuỗi rỗng)', async () => {
    const wrapper = mountDialog({
      editRule: ruleWith([{ kind: 'runTask', mode: 'create', prompt: 'việc', projectId: PROJ_B }]),
    })
    await flushPromises()

    const clearBtn = wrapper
      .findAll('.c-combo-clear')
      .find((b) => b.attributes('aria-label') === 'Project đích (tuỳ chọn)')!
    await clearBtn.trigger('mousedown')
    await flushPromises()

    const actions = await submitForm(wrapper)

    expect(actions[0]).not.toHaveProperty('projectId')
  })
})

describe('gợi ý task / profile / runner theo project đích', () => {
  it('bước trỏ project B lấy options của B; bước để trống vẫn lấy options project đang chọn', async () => {
    const wrapper = mountDialog({
      editRule: ruleWith([
        { kind: 'runTask', mode: 'existing', taskId: '', projectId: PROJ_B },
        { kind: 'runTask', mode: 'existing', taskId: '' },
      ]),
      optionsByProject: { [PROJ_B]: OPTIONS_B },
    })
    await flushPromises()

    const taskCombos = comboByLabel(wrapper, 'Task ID')
    expect(taskCombos).toHaveLength(2)

    await taskCombos[0].trigger('focus')
    const bOptions = [...taskCombos[0].element.closest('.c-combo-select')!.querySelectorAll('.c-select-option')].map(
      (o) => o.textContent?.trim(),
    )
    await taskCombos[1].trigger('focus')
    const aOptions = [...taskCombos[1].element.closest('.c-combo-select')!.querySelectorAll('.c-select-option')].map(
      (o) => o.textContent?.trim(),
    )

    expect(bOptions).toEqual(['TASK-B'])
    expect(aOptions).toEqual(['TASK-A'])
  })

  it('options của project đích chưa nạp xong → không mượn gợi ý của project khác', async () => {
    const wrapper = mountDialog({
      editRule: ruleWith([{ kind: 'runTask', mode: 'existing', taskId: '', projectId: PROJ_B }]),
      optionsByProject: {},
    })
    await flushPromises()

    const taskCombo = comboByLabel(wrapper, 'Task ID')[0]
    await taskCombo.trigger('focus')

    expect(taskCombo.element.closest('.c-combo-select')!.querySelector('.c-select-menu')).toBeNull()
  })

  it('đổi project đích → xoá task/profile/runner đã chọn của project cũ', async () => {
    const wrapper = mountDialog({
      editRule: ruleWith([
        { kind: 'runTask', mode: 'existing', taskId: 'TASK-A', runnerId: 'runner-a' },
      ]),
      optionsByProject: { [PROJ_B]: OPTIONS_B },
    })
    await flushPromises()
    expect((comboByLabel(wrapper, 'Task ID')[0].element as HTMLInputElement).value).toBe('TASK-A')

    await pickOption(comboByLabel(wrapper, 'Project đích (tuỳ chọn)')[0], 'Project B')

    // Task của project cũ không được tiếp tục trình bày như lựa chọn hợp lệ của B.
    expect((comboByLabel(wrapper, 'Task ID')[0].element as HTMLInputElement).value).toBe('')
  })
})

describe('i18n', () => {
  it('locale en hiện nhãn/placeholder/hint tiếng Anh, không lộ raw key', async () => {
    const wrapper = mountDialog({}, 'en')
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('Add step'))!
    await addBtn.trigger('click')
    await flushPromises()

    const combo = wrapper
      .findAll('input[role="combobox"]')
      .filter((i) => i.attributes('aria-label') === 'Target project (optional)')
    expect(combo).toHaveLength(1)
    expect(combo[0].attributes('placeholder')).toBe('Defaults to the current project')
    expect(wrapper.text()).toContain('Leave empty to run this step on the current project')
    expect(wrapper.text()).not.toContain('automations.action.targetProject')
  })
})
