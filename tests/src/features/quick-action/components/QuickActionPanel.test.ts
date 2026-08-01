import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n } from '../../../helpers/i18n'
import QuickActionPanel from '@/features/quick-action/components/QuickActionPanel.vue'

vi.mock('@/features/quick-action/QuickActionPanelApi', () => ({
  fetchArtifactActionsCatalog: vi.fn(async () => ({
    version: 1,
    menus: [],
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
}))

vi.mock('@/features/runner/RunnerApi', () => ({
  fetchRunners: vi.fn(async () => ({
    runners: [{ id: 'r1', name: 'Runner A', connectionId: 'conn-claude' }],
    connections: [{ id: 'conn-claude', providerId: 'claude-code-cli' }],
    defaultRunnerId: 'r1',
  })),
}))

vi.mock('@/features/pipeline-editor/PipelineEditorApi', () => ({
  fetchCatalog: vi.fn(async () => ({
    skills: [],
    agents: [
      { id: 'dashboard:my-agent', name: 'my-agent', description: '' },
      { id: 'repo:dev-agent-teams:doc-reviewer', name: 'doc-reviewer', description: '' },
    ],
  })),
}))

import { saveArtifactActionsCatalog } from '../../../../../src/features/quick-action/QuickActionPanelApi'

afterEach(() => vi.clearAllMocks())

describe('QuickActionPanel', () => {
  it('lists the loaded catalog (label / agent / attach, no id column)', async () => {
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    expect(w.text()).toContain('✨ Cải thiện tài liệu')
    expect(w.text()).toContain('dev-agent-teams:doc-reviewer') // agent column
    expect(w.text()).toContain('artifact-title')
  })

  it('+ New opens the editor dialog; save validates a missing label', async () => {
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click') // "+ New"
    expect(w.find('.qa-modal-overlay').exists()).toBe(true)
    expect(w.find('.qa-form').exists()).toBe(true)

    await w.get('.qa-form .btn-primary').trigger('click') // Lưu, with an empty draft
    expect(w.find('.qa-form .err').text()).toContain('label')
    expect(saveArtifactActionsCatalog).not.toHaveBeenCalled()
  })

  it('creates a new quick action, deriving the id from the label, and persists the catalog', async () => {
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    const inputs = w.findAll('.qa-form input.cfg-input') // [0]=label, [1]=patterns (id removed, agent is a <select>)
    await inputs[0].setValue('new-action') // label → derived id "new-action"
    await inputs[1].setValue('design.md') // patterns
    await w.get('.qa-form textarea').setValue('Đọc {{artifact_name}}')

    await w.get('.qa-form .btn-primary').trigger('click')
    await flushPromises()

    expect(saveArtifactActionsCatalog).toHaveBeenCalled()
    const [file] = vi.mocked(saveArtifactActionsCatalog).mock.calls[0]
    expect((file as any).actions.map((a: any) => a.id)).toContain('new-action')
    expect((file as any).menus).toEqual([])
    expect(w.find('.qa-form').exists()).toBe(false) // closes on success
  })

  it('binds agent_ref from the agent dropdown', async () => {
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    const inputs = w.findAll('.qa-form input.cfg-input')
    await inputs[0].setValue('with-agent')
    await inputs[1].setValue('design.md')
    await w.get('.qa-form textarea').setValue('Đọc {{artifact_name}}')
    // Form order: runner select, then agent select, then menu select.
    const selects = w.findAll('.qa-form select.cfg-input')
    await selects[1].setValue('dashboard:my-agent')

    await w.get('.qa-form .btn-primary').trigger('click')
    await flushPromises()

    const [file] = vi.mocked(saveArtifactActionsCatalog).mock.calls[0]
    const saved = (file as any).actions.find((a: any) => a.id === 'with-agent')
    expect(saved.agent_ref).toBe('dashboard:my-agent')
  })

  it('hides agent_ref and clears it when runner is console-command', async () => {
    const { fetchRunners } = await import('@/features/runner/RunnerApi')
    vi.mocked(fetchRunners).mockResolvedValueOnce({
      runners: [{ id: 'sh1', name: 'Shell', connectionId: 'conn-sh' }],
      connections: [{ id: 'conn-sh', providerId: 'console-command' }],
      defaultRunnerId: 'sh1',
    } as any)

    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    expect(w.text()).toContain('console-command')
    // Agent dropdown is not rendered for console-command runners.
    const selects = w.findAll('.qa-form select.cfg-input')
    // runner + menu only (no agent select)
    expect(selects.length).toBe(2)

    const inputs = w.findAll('.qa-form input.cfg-input')
    await inputs[0].setValue('shell-action')
    await inputs[1].setValue('design.md')
    await w.get('.qa-form textarea').setValue('--file {{artifact_name}}')
    await selects[0].setValue('sh1')

    await w.get('.qa-form .btn-primary').trigger('click')
    await flushPromises()

    const [file] = vi.mocked(saveArtifactActionsCatalog).mock.calls[0]
    const saved = (file as any).actions.find((a: any) => a.id === 'shell-action')
    expect(saved.agent_ref).toBe('')
    expect(saved.runner_id).toBe('sh1')
  })

  it('prompt help popover toggles a placeholder reference, hidden by default', async () => {
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
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
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null }, attachTo: document.body })
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
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null }, attachTo: document.body })
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
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    const inputs = w.findAll('.qa-form input.cfg-input')
    await inputs[0].setValue('appr-action') // label → derived id "appr-action"
    await inputs[1].setValue('design.md') // patterns
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
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button.btn-primary.btn-sm').trigger('click')
    await w.get('.btn-help-icon').trigger('click')
    expect(w.find('.qa-prompt-help').exists()).toBe(true)

    await w.get('.qa-form .btn-ghost').trigger('click') // Hủy
    await w.get('button.btn-primary.btn-sm').trigger('click') // + New again
    expect(w.find('.qa-prompt-help').exists()).toBe(false)
  })

  it('menu manager dialog can open, close, and reopen without error', async () => {
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    const manageBtn = w.get('button[aria-label="Quản lý menu"]')
    await manageBtn.trigger('click')
    expect(w.find('.qa-menu-dialog').exists()).toBe(true)

    await w.get('.qa-menu-dialog .btn-ghost').trigger('click')
    expect(w.find('.qa-menu-dialog').exists()).toBe(false)

    await manageBtn.trigger('click')
    expect(w.find('.qa-menu-dialog').exists()).toBe(true)
  })

  it('persists menus in the same catalog save', async () => {
    const w = mountWithI18n(QuickActionPanel, { props: { projectId: null } })
    await flushPromises()

    await w.get('button[aria-label="Quản lý menu"]').trigger('click')
    await w.get('.qa-menu-dialog-toolbar .icon-btn').trigger('click')
    await w.get('.qa-menu-editor .cfg-input').setValue('Nhóm tài liệu')
    await w.get('.qa-menu-dialog .btn-primary').trigger('click')
    await flushPromises()

    const [file] = vi.mocked(saveArtifactActionsCatalog).mock.calls[0]
    expect((file as any).menus).toEqual([
      expect.objectContaining({
        label: 'Nhóm tài liệu',
        children: [],
      }),
    ])
  })
})
