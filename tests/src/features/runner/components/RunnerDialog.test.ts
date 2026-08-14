import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, DOMWrapper } from '@vue/test-utils'
import RunnerDialog from '@/features/runner/components/RunnerDialog.vue'
import type { ConnectionOption, ProviderEntry } from '@/features/runner/types'

vi.mock('@/features/runner/scripts/RunnerDialogApi', () => ({
  saveRunner: vi.fn(async () => ({ ok: true })),
  submitJob: vi.fn(),
  fetchJob: vi.fn(),
}))

import { saveRunner } from '@/features/runner/scripts/RunnerDialogApi'

const connections: ConnectionOption[] = [
  { id: 'conn-1', label: 'Claude local', providerId: 'claude-code-cli' },
]

const providers: ProviderEntry[] = [{ id: 'claude-code-cli', kind: 'local-console', label: 'Claude Code CLI' }]

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(RunnerDialog, {
    props: { runner: null, connections, providers, ...props },
    attachTo: document.body,
  })
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('RunnerDialog — timeout dropdown', () => {
  it('renders timeout dropdown with 5 presets, default 10 phút', () => {
    mountDialog()
    const select = document.querySelector('select.timeout-select') as HTMLSelectElement
    expect(select).toBeTruthy()
    const options = [...select.querySelectorAll('option')]
    expect(options).toHaveLength(5)
    expect(select.value).toBe('600000')
  })

  it('selecting 60 phút persists timeoutMs = 3_600_000 on save payload', async () => {
    mountDialog()
    const select = new DOMWrapper(document.querySelector('select.timeout-select')!)
    await select.setValue('3600000')

    const nameInput = new DOMWrapper(document.querySelector('.field input.cfg-input')!)
    await nameInput.setValue('Runner test')

    const saveBtn = [...document.querySelectorAll('button.btn-primary')].find((b) =>
      b.textContent?.includes('Lưu'),
    ) as HTMLButtonElement
    saveBtn.click()
    await flushPromises()

    expect(saveRunner).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ timeoutMs: 3_600_000 }) }),
    )
  })
})
