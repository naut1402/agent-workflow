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

function mountDialog(step: Record<string, unknown> = STEP, stepId = 'investigator') {
  return mountWithI18n(StepConfigDialog, {
    props: { stepId, step, catalog: CATALOG },
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
      ['agent', 'hitl', 'knowledge_inputs', 'label', 'produces'],
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
