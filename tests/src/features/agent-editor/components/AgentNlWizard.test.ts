import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AgentNlWizard from '@/features/agent-editor/components/AgentNlWizard.vue'

// Correction A (F0005): the wizard is now multi-step (describe → preview →
// optional run), merged from the deleted Monitor-only AgentBuildWizard. Unlike
// the AS-IS draft-only wizard it no longer auto-applies/closes on generate —
// the user reviews the draft first, then either "Áp dụng vào editor" (no
// runner needed) or "Lưu & chạy thử" (gated behind a usable runner).

function stubApi(runners: { runners: any[]; defaultRunnerId: string | null }) {
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input)
    if (url.includes('/api/runners')) {
      return { ok: true, status: 200, json: async () => runners }
    }
    if (url.includes('/api/custom-agents/generate')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ draft: { name: 'reviewer', description: 'desc' } }),
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('AgentNlWizard', () => {
  it('renders the describe-step UI', () => {
    stubApi({ runners: [], defaultRunnerId: null })
    const w = mount(AgentNlWizard)
    expect(w.text()).toContain('Build từ mô tả')
    expect(w.find('button.btn-primary').text()).toContain('Generate draft')
    expect(w.find('.wizard-steps li.current').text()).toContain('1. Mô tả')
  })

  it('does not advance when the description is empty', async () => {
    stubApi({ runners: [], defaultRunnerId: null })
    const w = mount(AgentNlWizard)
    await w.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(w.find('.wizard-steps li.current').text()).toContain('1. Mô tả')
    expect(w.emitted('apply-draft')).toBeUndefined()
  })

  it('generate() advances to preview without auto-applying/closing', async () => {
    stubApi({ runners: [], defaultRunnerId: null })
    const w = mount(AgentNlWizard)
    await w.find('textarea').setValue('agent review code PHP')
    await w.find('button.btn-primary').trigger('click')
    await flushPromises()

    expect(w.find('.wizard-steps li.current').text()).toContain('2. Xem lại draft')
    expect(w.emitted('apply-draft')).toBeUndefined()
    expect(w.emitted('close')).toBeUndefined()
    expect((w.find('.cfg-input').element as HTMLInputElement).value).toBe('reviewer')
  })

  it('"Áp dụng vào editor" emits apply-draft + close without requiring a runner', async () => {
    stubApi({ runners: [], defaultRunnerId: null })
    const w = mount(AgentNlWizard)
    await w.find('textarea').setValue('agent review code PHP')
    await w.find('button.btn-primary').trigger('click')
    await flushPromises()

    const applyBtn = w.findAll('button').find((b) => b.text() === 'Áp dụng vào editor')
    expect(applyBtn).toBeTruthy()
    await applyBtn!.trigger('click')

    expect(w.emitted('apply-draft')?.[0]?.[0]).toMatchObject({ name: 'reviewer' })
    expect(w.emitted('close')).toBeTruthy()
  })

  it('disables "Lưu & chạy thử" and shows a message when no runner is usable', async () => {
    stubApi({ runners: [{ id: 'r1', name: 'A', enabled: false }], defaultRunnerId: null })
    const w = mount(AgentNlWizard)
    await flushPromises() // loadRunners on mount

    await w.find('textarea').setValue('agent review code PHP')
    await w.find('button.btn-primary').trigger('click')
    await flushPromises()

    expect(w.text()).toContain('Chưa có runner khả dụng')
    const runBtn = w.findAll('button').find((b) => b.text().includes('Lưu & chạy thử'))
    expect(runBtn?.attributes('disabled')).toBeDefined()
  })

  it('enables "Lưu & chạy thử" when a usable runner is loaded', async () => {
    stubApi({ runners: [{ id: 'r1', name: 'A' }], defaultRunnerId: 'r1' })
    const w = mount(AgentNlWizard)
    await flushPromises()

    await w.find('textarea').setValue('agent review code PHP')
    await w.find('button.btn-primary').trigger('click')
    await flushPromises()

    const runBtn = w.findAll('button').find((b) => b.text().includes('Lưu & chạy thử'))
    expect(runBtn?.attributes('disabled')).toBeUndefined()
  })
})
