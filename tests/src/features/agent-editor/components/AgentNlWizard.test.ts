import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AgentNlWizard from '@/features/agent-editor/components/AgentNlWizard.vue'

afterEach(() => vi.unstubAllGlobals())

describe('AgentNlWizard', () => {
  it('renders the NL prompt UI', () => {
    const w = mount(AgentNlWizard)
    expect(w.text()).toContain('Build từ mô tả')
    expect(w.find('button.btn-primary').text()).toContain('Generate draft')
  })

  it('does nothing when the description is empty', async () => {
    const w = mount(AgentNlWizard)
    await w.find('button.btn-primary').trigger('click')
    expect(w.emitted('apply-draft')).toBeUndefined()
  })

  it('generates a draft and emits apply-draft + close', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ draft: { name: 'reviewer' } }) })),
    )
    const w = mount(AgentNlWizard)
    await w.find('textarea').setValue('agent review code PHP')
    await w.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(w.emitted('apply-draft')?.[0]).toEqual([{ name: 'reviewer' }])
    expect(w.emitted('close')).toBeTruthy()
  })
})
