import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import ConnectionDialog from '@/features/runner/components/ConnectionDialog.vue'
import type { ProviderEntry } from '@/features/runner/types'
// `mountWithI18n` defaults to the 'vi' locale; read expected strings straight
// from the same message catalog the component renders from (`t()` isn't
// reachable off `wrapper.vm` here — Vue doesn't expose `<script setup>`
// bindings on the public instance without `defineExpose`).
import runnerVi from '@/features/runner/locales/vi'

// ConnectionDialog renders through <Teleport to="body"> — @vue/test-utils'
// wrapper.find()/findAll() only see the mount anchor, not the teleported
// content, even with `attachTo: document.body`. So every DOM query below goes
// through `document.body` directly instead of the wrapper.

vi.mock('@/features/runner/scripts/ConnectionDialogApi', () => ({
  fetchCredentials: vi.fn(async () => ({ profiles: [] })),
  saveCredential: vi.fn(async (profile: any) => ({ profile: { id: profile.id || 'minted-id', ...profile } })),
  saveConnection: vi.fn(async (connection: any) => ({ connection })),
  scanLocalCommands: vi.fn(async () => ({ commands: [] })),
  saveCustomCommand: vi.fn(async (c: unknown) => ({ command: c })),
  deleteCustomCommand: vi.fn(async () => ({ deleted: true })),
  fetchOAuthCapabilities: vi.fn(async () => ({ providers: [] })),
  startOAuthConnect: vi.fn(async () => ({ state: 'state-1', authorizeUrl: 'https://example.test/authorize' })),
  exchangeOAuthCode: vi.fn(async () => ({ credentialId: 'oauth-cred-1' })),
  fetchOAuthStatus: vi.fn(async () => ({ status: 'pending' })),
  fetchAvailableModels: vi.fn(async () => ({ models: [] })),
}))

import {
  fetchCredentials,
  saveCredential,
  saveConnection,
  fetchOAuthCapabilities,
  startOAuthConnect,
  fetchAvailableModels,
} from '@/features/runner/scripts/ConnectionDialogApi'

const PROVIDERS: ProviderEntry[] = [
  { id: 'anthropic-api', kind: 'ai-provider', label: 'Anthropic API', family: 'ai-api' },
  { id: 'openai-api', kind: 'ai-provider', label: 'OpenAI API', family: 'ai-api' },
  { id: 'gemini-api', kind: 'ai-provider', label: 'Gemini API', family: 'ai-api' },
]

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = document.body.querySelector<T>(selector)
  if (!el) throw new Error(`not found: ${selector}`)
  return el
}
function qa<T extends Element = HTMLElement>(selector: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(selector))
}
function buttonByText(text: string): HTMLButtonElement {
  const btn = qa<HTMLButtonElement>('button').find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`button not found: ${text}`)
  return btn
}
async function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}
async function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await flushPromises()
}

beforeEach(() => {
  vi.mocked(fetchCredentials).mockClear()
  vi.mocked(saveCredential).mockClear()
  vi.mocked(saveConnection).mockClear()
  vi.mocked(fetchOAuthCapabilities).mockClear()
  vi.mocked(startOAuthConnect).mockClear()
  vi.mocked(fetchAvailableModels).mockClear()
  vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: [] })
  vi.mocked(fetchAvailableModels).mockResolvedValue({ models: [] })
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mountOnAiProvider() {
  const w = mount(ConnectionDialog, { props: { providers: PROVIDERS }, attachTo: document.body })
  await flushPromises()
  const aiRadio = q<HTMLInputElement>('input[type="radio"][value="ai-provider"]')
  aiRadio.checked = true
  aiRadio.dispatchEvent(new Event('change'))
  await flushPromises()
  return w
}

describe('ConnectionDialog — credential form', () => {
  it('no longer asks the user to type a credential id', async () => {
    await mountOnAiProvider()
    await click(buttonByText('+ Credential'))
    expect(document.body.textContent).not.toContain('Credential ID')
  })

  it('blocks saving a new credential with neither a secret value nor a secretRef', async () => {
    await mountOnAiProvider()
    await click(buttonByText('+ Credential'))
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))
    expect(saveCredential).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.credentialSecretRequired)
  })

  it('saves with secretValue (pasted secret) rather than a raw secretRef', async () => {
    await mountOnAiProvider()
    await click(buttonByText('+ Credential'))
    await setInputValue(q<HTMLInputElement>('input[type="password"]'), 'sk-pasted-secret')
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))

    expect(saveCredential).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.secretValue).toBe('sk-pasted-secret')
    expect(payload.secretRef).toBeUndefined()
    expect(payload.id).toBeUndefined()
  })

  it('falls back to the advanced secretRef field when no secret value is pasted', async () => {
    await mountOnAiProvider()
    await click(buttonByText('+ Credential'))
    const advancedInput = q<HTMLInputElement>('input[placeholder="env:ANTHROPIC_API_KEY"]')
    await setInputValue(advancedInput, 'env:MY_OWN_VAR')
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))

    expect(saveCredential).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.secretRef).toBe('env:MY_OWN_VAR')
    expect(payload.secretValue).toBeUndefined()
  })
})

describe('ConnectionDialog — Connect via browser (OAuth)', () => {
  it('hides the button when the provider has no OAuth capability', async () => {
    await mountOnAiProvider()
    await click(buttonByText('+ Credential'))
    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.connectViaBrowser)
  })

  it('shows the button once the provider is reported OAuth-capable, and starts the flow on click', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: ['gemini-api'] })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mountOnAiProvider()
    const providerSelect = q<HTMLSelectElement>('select')
    providerSelect.value = 'gemini-api'
    providerSelect.dispatchEvent(new Event('change'))
    await flushPromises()
    await click(buttonByText('+ Credential'))

    const connectText = runnerVi.connectionDialog.connectViaBrowser
    expect(document.body.textContent).toContain(connectText)
    await click(buttonByText(connectText))

    expect(startOAuthConnect).toHaveBeenCalledWith('gemini-api', expect.any(String))
    expect(openSpy).toHaveBeenCalledWith('https://example.test/authorize', '_blank', 'noopener')
    openSpy.mockRestore()
  })

  it('hides Connect via browser too when the vault itself is unconfigured, even for an OAuth-capable provider', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: ['gemini-api'], vaultConfigured: false })
    await mountOnAiProvider()
    const providerSelect = q<HTMLSelectElement>('select')
    providerSelect.value = 'gemini-api'
    providerSelect.dispatchEvent(new Event('change'))
    await flushPromises()
    await click(buttonByText('+ Credential'))

    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.connectViaBrowser)
  })
})

describe('ConnectionDialog — vault not configured', () => {
  it('warns and disables the secret value field instead of letting the user hit a raw save error', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: [], vaultConfigured: false })
    await mountOnAiProvider()
    await click(buttonByText('+ Credential'))

    expect(document.body.textContent).toContain(runnerVi.connectionDialog.vaultNotConfigured)
    expect(q<HTMLInputElement>('input[type="password"]').disabled).toBe(true)
  })
})

describe('ConnectionDialog — model & base URL', () => {
  it('renders "Load models" as an icon button, not a text button', async () => {
    await mountOnAiProvider()
    expect(qa<HTMLButtonElement>('button').some((b) => b.textContent?.trim() === runnerVi.connectionDialog.loadModels)).toBe(false)
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)
    expect(loadBtn).toBeTruthy()
    expect(loadBtn?.querySelector('svg')).toBeTruthy()
  })

  it('keeps the base URL input hidden until its toggle is switched on', async () => {
    await mountOnAiProvider()
    expect(document.body.querySelector('input[placeholder="https://api.anthropic.com"]')).toBeNull()

    const toggleBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.showBaseUrl)
    expect(toggleBtn).toBeTruthy()
    await click(toggleBtn!)

    expect(document.body.querySelector('input[placeholder="https://api.anthropic.com"]')).toBeTruthy()
    const hideBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.hideBaseUrl)
    expect(hideBtn).toBeTruthy()
  })

  it('lets the model field stay empty (nullable) — save is not blocked', async () => {
    await mountOnAiProvider()
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.config.model).toBeUndefined()
    expect(payload.config.models).toBeUndefined()
  })

  it('picks multiple models from the loaded list and saves models[] plus a first-entry model for the current single-model runtime', async () => {
    await mountOnAiProvider()
    await click(buttonByText('+ Credential'))
    await setInputValue(q<HTMLInputElement>('input[type="password"]'), 'sk-test')
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({ models: ['claude-a', 'claude-b'] })

    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)!
    await click(loadBtn)

    const multiSelectTrigger = q<HTMLButtonElement>('.c-multi-select .c-select-trigger')
    await click(multiSelectTrigger)
    const options = qa<HTMLLIElement>('.c-multi-select .c-select-option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['claude-a', 'claude-b'])
    await click(options[0])
    await click(options[1])

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.config.models).toEqual(['claude-a', 'claude-b'])
    expect(payload.config.model).toBe('claude-a')
  })
})
