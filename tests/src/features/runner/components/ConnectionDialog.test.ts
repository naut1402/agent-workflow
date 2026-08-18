import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import ConnectionDialog from '@/features/runner/components/ConnectionDialog.vue'
import ProviderDialog from '@/features/runner/components/ProviderDialog.vue'
import type { ProviderConfigOption, ProviderEntry } from '@/features/runner/types'
// `mountWithI18n` defaults to the 'vi' locale; read expected strings straight
// from the same message catalog the component renders from (`t()` isn't
// reachable off `wrapper.vm` here — Vue doesn't expose `<script setup>`
// bindings on the public instance without `defineExpose`).
import runnerVi from '@/features/runner/locales/vi'

// Both dialogs render through <Teleport to="body"> — @vue/test-utils'
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

vi.mock('@/features/runner/scripts/ProviderDialogApi', () => ({
  fetchProviderConfigs: vi.fn(async () => ({ providerConfigs: [] })),
  saveProviderConfig: vi.fn(async (pc: any) => ({ providerConfig: pc })),
  deleteProviderConfig: vi.fn(async () => ({ deleted: true })),
}))

import {
  fetchCredentials,
  saveCredential,
  saveConnection,
  fetchOAuthCapabilities,
  startOAuthConnect,
  fetchAvailableModels,
} from '@/features/runner/scripts/ConnectionDialogApi'
import { fetchProviderConfigs } from '@/features/runner/scripts/ProviderDialogApi'

const PROVIDERS: ProviderEntry[] = [
  { id: 'anthropic-api', kind: 'ai-provider', label: 'Anthropic API', family: 'ai-api' },
  { id: 'openai-api', kind: 'ai-provider', label: 'OpenAI API', family: 'ai-api' },
  { id: 'gemini-api', kind: 'ai-provider', label: 'Gemini API', family: 'ai-api' },
]

const PROVIDER_CONFIGS: ProviderConfigOption[] = [
  { id: 'pc-anthropic', label: 'Anthropic chính', providerId: 'anthropic-api', credentialId: 'cred-anthropic' },
  {
    id: 'pc-gemini',
    label: 'Gemini gateway',
    providerId: 'gemini-api',
    credentialId: 'cred-gemini',
    baseURL: 'https://gemini.example/v1',
  },
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
function buttonByTitle(title: string): HTMLButtonElement {
  const btn = qa<HTMLButtonElement>('button').find((b) => b.title === title)
  if (!btn) throw new Error(`button not found: ${title}`)
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
  vi.mocked(fetchProviderConfigs).mockClear()
  vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: [] })
  vi.mocked(fetchAvailableModels).mockResolvedValue({ models: [] })
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mountProviderDialog(providerConfig: ProviderConfigOption | null = null) {
  const w = mount(ProviderDialog, {
    props: { providers: PROVIDERS, providerConfig },
    attachTo: document.body,
  })
  await flushPromises()
  return w
}

async function mountConnectionOnAiProvider() {
  const w = mount(ConnectionDialog, {
    props: { providers: PROVIDERS, providerConfigs: PROVIDER_CONFIGS },
    attachTo: document.body,
  })
  await flushPromises()
  const aiRadio = q<HTMLInputElement>('input[type="radio"][value="ai-provider"]')
  aiRadio.checked = true
  aiRadio.dispatchEvent(new Event('change'))
  await flushPromises()
  return w
}

describe('ProviderDialog — credential form', () => {
  it('no longer asks the user to type a credential id', async () => {
    await mountProviderDialog()
    await click(buttonByTitle(runnerVi.providerDialog.addCredential))
    expect(document.body.textContent).not.toContain('Credential ID')
  })

  it('blocks saving a new credential with neither a secret value nor a secretRef', async () => {
    await mountProviderDialog()
    await click(buttonByTitle(runnerVi.providerDialog.addCredential))
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))
    expect(saveCredential).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.credentialSecretRequired)
  })

  it('saves with secretValue (pasted secret) rather than a raw secretRef', async () => {
    await mountProviderDialog()
    await click(buttonByTitle(runnerVi.providerDialog.addCredential))
    await setInputValue(q<HTMLInputElement>('input[type="password"]'), 'sk-pasted-secret')
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))

    expect(saveCredential).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.secretValue).toBe('sk-pasted-secret')
    expect(payload.secretRef).toBeUndefined()
    expect(payload.id).toBeUndefined()
  })

  it('falls back to the advanced secretRef field when no secret value is pasted', async () => {
    await mountProviderDialog()
    await click(buttonByTitle(runnerVi.providerDialog.addCredential))
    const advancedInput = q<HTMLInputElement>('input[placeholder="env:ANTHROPIC_API_KEY"]')
    await setInputValue(advancedInput, 'env:MY_OWN_VAR')
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))

    expect(saveCredential).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.secretRef).toBe('env:MY_OWN_VAR')
    expect(payload.secretValue).toBeUndefined()
  })
})

describe('ProviderDialog — Connect via browser (OAuth)', () => {
  it('hides the button when the provider has no OAuth capability', async () => {
    await mountProviderDialog()
    await click(buttonByTitle(runnerVi.providerDialog.addCredential))
    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.connectViaBrowser)
  })

  it('shows the button once the provider is reported OAuth-capable, and starts the flow on click', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: ['gemini-api'] })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mountProviderDialog()
    const interfaceSelect = q<HTMLSelectElement>('select')
    interfaceSelect.value = 'gemini-api'
    interfaceSelect.dispatchEvent(new Event('change'))
    await flushPromises()
    await click(buttonByTitle(runnerVi.providerDialog.addCredential))

    const connectText = runnerVi.connectionDialog.connectViaBrowser
    expect(document.body.textContent).toContain(connectText)
    await click(buttonByText(connectText))

    expect(startOAuthConnect).toHaveBeenCalledWith('gemini-api', expect.any(String))
    expect(openSpy).toHaveBeenCalledWith('https://example.test/authorize', '_blank', 'noopener')
    openSpy.mockRestore()
  })

  it('hides Connect via browser too when the vault itself is unconfigured, even for an OAuth-capable provider', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: ['gemini-api'], vaultConfigured: false })
    await mountProviderDialog()
    await click(buttonByTitle(runnerVi.providerDialog.addCredential))

    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.connectViaBrowser)
  })
})

describe('ProviderDialog — vault not configured', () => {
  it('warns and disables the secret value field instead of letting the user hit a raw save error', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: [], vaultConfigured: false })
    await mountProviderDialog()
    await click(buttonByTitle(runnerVi.providerDialog.addCredential))

    expect(document.body.textContent).toContain(runnerVi.connectionDialog.vaultNotConfigured)
    expect(q<HTMLInputElement>('input[type="password"]').disabled).toBe(true)
  })
})

describe('ProviderDialog — base URL', () => {
  it('always shows the base URL input (no toggle) with the provider default as placeholder', async () => {
    await mountProviderDialog()
    const baseUrlInput = q<HTMLInputElement>('input[placeholder="https://api.anthropic.com"]')
    expect(baseUrlInput).toBeTruthy()
  })

  it('prefills from an edited provider config', async () => {
    await mountProviderDialog(PROVIDER_CONFIGS[1])
    const labelInput = q<HTMLInputElement>('input[placeholder="vd. OpenAI gateway của tôi"]')
    expect(labelInput.value).toBe('Gemini gateway')
    // Interface select reflects the saved provider, base URL the saved endpoint.
    const interfaceSelect = q<HTMLSelectElement>('select')
    expect(interfaceSelect.value).toBe('gemini-api')
    const baseUrlInput = qa<HTMLInputElement>('.field input').find((i) => i.value === 'https://gemini.example/v1')
    expect(baseUrlInput).toBeTruthy()
  })
})

describe('ConnectionDialog — provider config picker', () => {
  it('lists configured providers instead of raw interfaces/credentials', async () => {
    await mountConnectionOnAiProvider()
    const providerSelect = qa<HTMLSelectElement>('select').find((s) =>
      Array.from(s.options).some((o) => o.value === 'pc-anthropic'),
    )
    expect(providerSelect).toBeTruthy()
    expect(document.body.textContent).not.toContain('+ Credential')
  })

  it('blocks saving when no provider config is selected', async () => {
    await mountConnectionOnAiProvider()
    // Empty the selection first.
    const providerSelect = qa<HTMLSelectElement>('select').find((s) =>
      Array.from(s.options).some((o) => o.value === 'pc-anthropic'),
    )!
    providerSelect.value = ''
    providerSelect.dispatchEvent(new Event('change'))
    await flushPromises()

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'My conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.providerConfigRequired)
  })

  it('saves a self-contained connection (providerId + credentialId copied from the provider config)', async () => {
    await mountConnectionOnAiProvider()
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.kind).toBe('ai-provider')
    expect(payload.providerId).toBe('anthropic-api')
    expect(payload.credentialId).toBe('cred-anthropic')
    expect(payload.config.providerConfigId).toBe('pc-anthropic')
    // Default endpoint provider config — no baseURL copied.
    expect(payload.config.baseURL).toBeUndefined()
    expect(payload.config.model).toBeUndefined()
    expect(payload.config.models).toBeUndefined()
  })

  it('copies the provider config base URL into the saved connection', async () => {
    await mountConnectionOnAiProvider()
    const providerSelect = qa<HTMLSelectElement>('select').find((s) =>
      Array.from(s.options).some((o) => o.value === 'pc-gemini'),
    )!
    providerSelect.value = 'pc-gemini'
    providerSelect.dispatchEvent(new Event('change'))
    await flushPromises()

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Gemini conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.providerId).toBe('gemini-api')
    expect(payload.credentialId).toBe('cred-gemini')
    expect(payload.config.baseURL).toBe('https://gemini.example/v1')
  })

  it('prefills a legacy connection by matching provider + credential when no providerConfigId link exists', async () => {
    const w = mount(ConnectionDialog, {
      props: {
        providers: PROVIDERS,
        providerConfigs: PROVIDER_CONFIGS,
        connection: {
          id: 'legacy-api',
          label: 'Legacy API conn',
          kind: 'ai-provider',
          providerId: 'gemini-api',
          credentialId: 'cred-gemini',
        },
      },
      attachTo: document.body,
    })
    await flushPromises()
    const providerSelect = qa<HTMLSelectElement>('select').find((s) =>
      Array.from(s.options).some((o) => o.value === 'pc-gemini'),
    )
    expect(providerSelect?.value).toBe('pc-gemini')
    w.unmount()
  })
})

describe('ConnectionDialog — model list', () => {
  it('renders "Load models" as an icon button, not a text button', async () => {
    await mountConnectionOnAiProvider()
    expect(
      qa<HTMLButtonElement>('button').some((b) => b.textContent?.trim() === runnerVi.connectionDialog.loadModels),
    ).toBe(false)
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)
    expect(loadBtn).toBeTruthy()
    expect(loadBtn?.querySelector('svg')).toBeTruthy()
  })

  it('loads models through the selected provider config credential and saves models[] plus a first-entry model for the current single-model runtime', async () => {
    await mountConnectionOnAiProvider()
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({ models: ['claude-a', 'claude-b'] })

    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)!
    await click(loadBtn)

    expect(fetchAvailableModels).toHaveBeenCalledWith({
      providerId: 'anthropic-api',
      credentialId: 'cred-anthropic',
      baseURL: undefined,
    })

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
    expect(payload.config.providerConfigId).toBe('pc-anthropic')
  })
})
