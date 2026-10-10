import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import StepConfigDialog from '@/features/pipeline-editor/components/StepConfigDialog.vue'

// Cấu hình step giờ là dialog (`.modal` + Teleport). Skills / rule category /
// rule required đã bị gỡ khỏi canvas nên không được xuất hiện ở đây, và payload
// `update` cũng không được mang chúng theo.

vi.mock('@/features/knowledge/scripts/knowledgeApi', () => ({
  fetchKnowledgeList: vi.fn(async () => ({ entries: [] })),
}))

const CATALOG = { agents: [{ id: 'investigator', name: 'investigator' }], skills: [] }

const STEP = {
  label: 'Investigate',
  agent: 'dev-agent-teams:investigator',
  produces: ['investigate.md'],
  knowledge_inputs: [],
  hitl: { mode: 'none' },
}

function mountDialog(
  step: Record<string, unknown> = STEP,
  stepId = 'investigator',
  runnerOptions: { value: string; label: string }[] = [],
) {
  return mountWithI18n(StepConfigDialog, {
    props: { stepId, step, catalog: CATALOG, runnerOptions },
    // Teleport đẩy nội dung ra <body>; stub để assert ngay trên wrapper.
    global: { stubs: { Teleport: true } },
  })
}

beforeEach(() => vi.clearAllMocks())

describe('StepConfigDialog', () => {
  it('renders as a modal dialog following the .modal / .modal-body contract', () => {
    const w = mountDialog()
    const modal = w.find('.modal.step-config-dialog')
    expect(modal.exists()).toBe(true)
    expect(modal.attributes('role')).toBe('dialog')
    expect(modal.attributes('aria-modal')).toBe('true')
    expect(w.findAll('.modal-body')).toHaveLength(1)
  })

  it('renders the five remaining control groups', () => {
    const w = mountDialog()
    const text = w.text()
    expect(text).toContain('Tên')
    expect(text).toContain('Agent')
    expect(text).toContain('Sản phẩm (artifact)')
    expect(text).toContain('Knowledge inputs')
    expect(text).toContain('HITL gate')
  })

  it('drops the skills / rule category / rule required controls', () => {
    const w = mountDialog({ ...STEP, skills: ['survey'], rule_category: 'doc-writing', rule_required: true })
    expect(w.text()).not.toContain('Skills')
    expect(w.text()).not.toContain('Rule category')
    expect(w.text()).not.toContain('survey')
    expect(w.find('#catalog-skills-list').exists()).toBe(false)
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('applies edits and emits a payload without the removed keys', async () => {
    const w = mountDialog()
    await w.findAll('input.cfg-input')[0].setValue('Khảo sát')
    const producesInput = w.findAll('.tag-input-row input')[0]
    await producesInput.setValue('design.md')
    await producesInput.trigger('keydown.enter')
    await w.find('.btn-primary').trigger('click')

    const [stepId, payload] = w.emitted('update')![0] as [string, Record<string, unknown>]
    expect(stepId).toBe('investigator')
    expect(payload.label).toBe('Khảo sát')
    expect(payload.produces).toEqual(['investigate.md', 'design.md'])
    expect(Object.keys(payload).sort()).toEqual(
      ['agent', 'hitl', 'knowledge_inputs', 'label', 'produces', 'runner_id'],
    )
  })

  it('emits close from Cancel and ✕ without emitting update', async () => {
    const w = mountDialog()
    await w.find('.modal-actions .btn-ghost').trigger('click')
    await w.find('.modal-close').trigger('click')
    expect(w.emitted('close')).toHaveLength(2)
    expect(w.emitted('update')).toBeUndefined()
  })

  it('rebuilds the draft when the step prop changes', async () => {
    const w = mountDialog()
    await w.setProps({ step: { ...STEP, label: 'Review', produces: [] } })
    expect((w.findAll('input.cfg-input')[0].element as HTMLInputElement).value).toBe('Review')
    expect(w.find('.tag-row .chip').exists()).toBe(false)
  })

  it('shows the gate fields and falls back to hitl-<stepId> when gate id is blank', async () => {
    const w = mountDialog({ ...STEP, hitl: { mode: 'manual' } })
    expect(w.text()).toContain('Gate ID')
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(2)

    await w.find('.btn-primary').trigger('click')

    const [, payload] = w.emitted('update')![0] as [string, Record<string, any>]
    expect(payload.hitl).toEqual({
      mode: 'manual',
      gate_id: 'hitl-investigator',
      optional_doc_review: false,
      blocking: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Tbfb52394 · nhóm G của test-spec — control "Model" trên dialog cấu hình step.
//
// AC-3 nói "chỉ cho chỉ định model khác khi có nhiều hơn 1 runner": ≤ 1 option
// thì control không render. Nhưng ẩn control KHÔNG được đồng nghĩa xoá dữ liệu —
// mở dialog để sửa tên step trên máy chỉ còn 1 runner mà mất pin cũ là mất dữ
// liệu âm thầm (TC-G08).
// ---------------------------------------------------------------------------

const TWO_MODELS = [
  { value: 'r-gemini', label: 'gemini-2.5-pro' },
  { value: 'r-sonnet', label: 'claude-sonnet-5' },
]

/** Root của CSelect "Model" — `id` fallthrough xuống thẻ bọc của component. */
function modelSelect(w: ReturnType<typeof mountDialog>) {
  return w.find('#step-config-runner')
}

/** Mở menu rồi bấm option có nhãn cho trước. */
async function pickModel(w: ReturnType<typeof mountDialog>, label: string) {
  await modelSelect(w).find('.c-select-trigger').trigger('click')
  const option = modelSelect(w)
    .findAll('.c-select-option')
    .find((li) => li.text() === label)
  if (!option) throw new Error(`không có option "${label}" trong menu Model`)
  await option.trigger('click')
}

async function applyAndGetPayload(w: ReturnType<typeof mountDialog>) {
  await w.find('.btn-primary').trigger('click')
  const [, payload] = w.emitted('update')![0] as [string, Record<string, any>]
  return payload
}

describe('StepConfigDialog — control Model', () => {
  it('TC-G01: danh sách option rỗng ⇒ control KHÔNG render', () => {
    const w = mountDialog(STEP, 'investigator', [])
    expect(modelSelect(w).exists()).toBe(false)
    expect(w.text()).not.toContain('Model')
  })

  it('TC-G02: đúng 1 option ⇒ control KHÔNG render — "nhiều hơn 1" nghĩa là ≥ 2', () => {
    const w = mountDialog(STEP, 'investigator', [TWO_MODELS[0]])
    expect(modelSelect(w).exists()).toBe(false)
  })

  it('TC-G03: 2 option ⇒ control render, có nhãn i18n và aria-label', () => {
    const w = mountDialog(STEP, 'investigator', TWO_MODELS)
    const select = modelSelect(w)
    expect(select.exists()).toBe(true)
    expect(w.text()).toContain('Model')
    expect(select.find('.c-select-trigger').attributes('aria-label')).toBe('Model')
    // Gợi ý dưới control phải đi qua i18n, không phải chuỗi cứng.
    expect(w.find('.cfg-hint').text().length).toBeGreaterThan(0)
  })

  it('TC-G04: step chưa pin ⇒ mục đầu là "theo mặc định hệ thống" (value rỗng) và đang được chọn', async () => {
    const w = mountDialog(STEP, 'investigator', TWO_MODELS)
    const select = modelSelect(w)
    expect(select.find('.c-select-value').text()).toBe('Theo mặc định hệ thống')

    await select.find('.c-select-trigger').trigger('click')
    const labels = select.findAll('.c-select-option').map((li) => li.text())
    expect(labels).toEqual(['Theo mặc định hệ thống', 'gemini-2.5-pro', 'claude-sonnet-5'])
    expect(select.findAll('.c-select-option')[0].attributes('aria-selected')).toBe('true')
  })

  it('TC-G05: chọn model thứ hai ⇒ payload mang RUNNER ID, không phải chuỗi model', async () => {
    const w = mountDialog(STEP, 'investigator', TWO_MODELS)
    await pickModel(w, 'claude-sonnet-5')
    const payload = await applyAndGetPayload(w)
    expect(payload.runner_id).toBe('r-sonnet')
    expect(payload.runner_id).not.toBe('claude-sonnet-5')
  })

  it('TC-G06: step đang pin ⇒ chọn lại "theo mặc định" phát ra runner_id rỗng (gỡ pin)', async () => {
    const w = mountDialog({ ...STEP, runner_id: 'r-gemini' }, 'investigator', TWO_MODELS)
    expect(modelSelect(w).find('.c-select-value').text()).toBe('gemini-2.5-pro')

    await pickModel(w, 'Theo mặc định hệ thống')
    expect(await applyAndGetPayload(w)).toMatchObject({ runner_id: '' })
  })

  it('TC-G07: pin trỏ runner đã biến mất ⇒ vẫn có một mục ghi chú "không còn khả dụng", đang được chọn', async () => {
    const w = mountDialog({ ...STEP, runner_id: 'da-xoa' }, 'investigator', TWO_MODELS)
    const select = modelSelect(w)
    // Không được hiện id thô không ai hiểu, cũng không được im lặng nhảy về mặc định.
    expect(select.find('.c-select-value').text()).toContain('da-xoa')
    expect(select.find('.c-select-value').text()).toContain('không còn khả dụng')

    await select.find('.c-select-trigger').trigger('click')
    const selected = select.findAll('.c-select-option').filter((li) => li.attributes('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0].text()).toContain('da-xoa')
  })

  it('TC-G07b: gỡ được pin hỏng đó về mặc định', async () => {
    const w = mountDialog({ ...STEP, runner_id: 'da-xoa' }, 'investigator', TWO_MODELS)
    await pickModel(w, 'Theo mặc định hệ thống')
    expect(await applyAndGetPayload(w)).toMatchObject({ runner_id: '' })
  })

  it('TC-G08: control bị ẩn (≤ 1 runner) ⇒ Áp dụng KHÔNG được xoá pin cũ', async () => {
    const w = mountDialog({ ...STEP, runner_id: 'da-xoa' }, 'investigator', [TWO_MODELS[0]])
    expect(modelSelect(w).exists()).toBe(false)
    // Mở dialog sửa tên step rồi lưu — pin phải còn nguyên.
    await w.findAll('input.cfg-input')[0].setValue('Khảo sát')
    const payload = await applyAndGetPayload(w)
    expect(payload.label).toBe('Khảo sát')
    expect(payload.runner_id).toBe('da-xoa')
  })

  it('TC-G08b: không có option nào (nạp runner lỗi) ⇒ pin cũ vẫn đi qua nguyên vẹn', async () => {
    const w = mountDialog({ ...STEP, runner_id: 'r-gemini' }, 'investigator', [])
    expect(await applyAndGetPayload(w)).toMatchObject({ runner_id: 'r-gemini' })
  })

  it('dựng lại draft khi đổi step: pin của step mới thắng pin của step cũ', async () => {
    const w = mountDialog({ ...STEP, runner_id: 'r-gemini' }, 'investigator', TWO_MODELS)
    await w.setProps({ step: { ...STEP, runner_id: 'r-sonnet' } })
    expect(modelSelect(w).find('.c-select-value').text()).toBe('claude-sonnet-5')
  })
})
