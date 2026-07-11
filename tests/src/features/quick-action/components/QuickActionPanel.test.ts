import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import QuickActionPanel from '@/features/quick-action/components/QuickActionPanel.vue'

vi.mock('@/api', () => ({
  fetchArtifactActionsCatalog: vi.fn(async () => ({
    version: 1,
    actions: [
      {
        id: 'improve-doc',
        label: '✨ Cải thiện tài liệu',
        artifact_patterns: ['design.md'],
        agent_ref: 'dev-agent-teams:doc-reviewer',
        prompt_template: 'Đọc {{artifact_name}}',
        produces: [],
        confirm: true,
        attach_points: ['artifact-title'],
      },
    ],
  })),
  saveArtifactActionsCatalog: vi.fn(async (file: any) => ({ ok: true, ...file })),
  fetchRunners: vi.fn(async () => ({ runners: [{ id: 'r1', name: 'Runner A' }], defaultRunnerId: 'r1' })),
}))

import { saveArtifactActionsCatalog } from '@/api'

afterEach(() => vi.clearAllMocks())

describe('QuickActionPanel', () => {
  it('lists the loaded catalog', async () => {
    const w = mount(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    expect(w.text()).toContain('improve-doc')
    expect(w.text()).toContain('✨ Cải thiện tài liệu')
    expect(w.text()).toContain('artifact-title')
  })

  it('+ New opens an empty form; save validates a missing id', async () => {
    const w = mount(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click') // "+ New"
    expect(w.find('.qa-form').exists()).toBe(true)

    await w.get('.qa-form .btn-primary').trigger('click') // Lưu, with an empty draft
    expect(w.find('.qa-form .err').text()).toContain('id')
    expect(saveArtifactActionsCatalog).not.toHaveBeenCalled()
  })

  it('creates a new quick action and persists the full catalog', async () => {
    const w = mount(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    const inputs = w.findAll('.qa-form input.cfg-input')
    await inputs[0].setValue('new-action') // id
    await inputs[1].setValue('Nút mới') // label
    await inputs[2].setValue('design.md') // patterns
    await inputs[3].setValue('dev-agent-teams:doc-reviewer') // agent_ref
    await w.get('.qa-form textarea').setValue('Đọc {{artifact_name}}')

    await w.get('.qa-form .btn-primary').trigger('click')
    await flushPromises()

    expect(saveArtifactActionsCatalog).toHaveBeenCalled()
    const [file] = vi.mocked(saveArtifactActionsCatalog).mock.calls[0]
    expect((file as any).actions.map((a: any) => a.id)).toContain('new-action')
    expect(w.find('.qa-form').exists()).toBe(false) // closes on success
  })

  it('prompt help popover toggles a placeholder reference, hidden by default', async () => {
    const w = mount(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click') // "+ New"
    expect(w.find('.qa-prompt-help').exists()).toBe(false)

    await w.get('.btn-help-icon').trigger('click')
    await flushPromises()
    expect(w.find('.qa-prompt-help').exists()).toBe(true)
    const helpText = w.get('.qa-prompt-help').text()
    expect(helpText).toContain('{{artifact_name}}')
    expect(helpText).toContain('{{artifact_base}}')
    expect(helpText).toContain('{{selection}}')
    expect(helpText).toContain('{{selection_lines}}')
    // Selection-only placeholders are called out as requiring the
    // "Text selection" attach point.
    expect(helpText).toContain('Text selection')
    // The popover reminds that the prompt must overwrite the file (Write), since
    // runner stdout is not persisted.
    expect(helpText).toContain('Write')

    await w.get('.btn-help-icon').trigger('click') // click again → hides
    await flushPromises()
    expect(w.find('.qa-prompt-help').exists()).toBe(false)
  })

  it('prompt help popover closes on an outside click', async () => {
    const w = mount(QuickActionPanel, { props: { projectId: null }, attachTo: document.body })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    await w.get('.btn-help-icon').trigger('click')
    await flushPromises()
    expect(w.find('.qa-prompt-help').exists()).toBe(true)

    document.body.click() // click anywhere outside the popover / help button
    await flushPromises()
    expect(w.find('.qa-prompt-help').exists()).toBe(false)
    w.unmount()
  })

  it('prompt help popover closes on Escape', async () => {
    const w = mount(QuickActionPanel, { props: { projectId: null }, attachTo: document.body })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    await w.get('.btn-help-icon').trigger('click')
    await flushPromises()
    expect(w.find('.qa-prompt-help').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('.qa-prompt-help').exists()).toBe(false)
    w.unmount()
  })

  it('persists require_approval when the checkbox is checked', async () => {
    const w = mount(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    const inputs = w.findAll('.qa-form input.cfg-input')
    await inputs[0].setValue('appr-action') // id
    await inputs[1].setValue('Cần duyệt') // label
    await inputs[2].setValue('design.md') // patterns
    await w.get('.qa-form textarea').setValue('Ghi đè {{artifact_name}} bằng Write')

    // The require_approval checkbox is the last .qa-attach-option checkbox
    // (after the two attach-point checkboxes and the confirm checkbox).
    const checkboxes = w.findAll('.qa-attach-option input[type="checkbox"]')
    await checkboxes[checkboxes.length - 1].setValue(true)

    await w.get('.qa-form .btn-primary').trigger('click')
    await flushPromises()

    const [file] = vi.mocked(saveArtifactActionsCatalog).mock.calls[0]
    const saved = (file as any).actions.find((a: any) => a.id === 'appr-action')
    expect(saved.require_approval).toBe(true)
  })

  it('prompt help resets to hidden when the form is reopened', async () => {
    const w = mount(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    await w.get('.btn-help-icon').trigger('click')
    expect(w.find('.qa-prompt-help').exists()).toBe(true)

    await w.get('.qa-form .btn-ghost').trigger('click') // Hủy
    await w.get('button.btn-primary.btn-sm').trigger('click') // + New again
    expect(w.find('.qa-prompt-help').exists()).toBe(false)
  })
})
