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

const CREDENTIALS = [
  { id: 'cred-anthropic', provider: 'anthropic-api', label: 'Anthropic chính', secretRef: 'vault:cred-anthropic' },
  { id: 'cred-gemini', provider: 'gemini-api', label: 'Gemini gateway', secretRef: 'vault:cred-gemini' },
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
function selectByLabel(label: string): HTMLSelectElement {
  const select = qa<HTMLSelectElement>('label').find((l) => l.textContent?.trim().startsWith(label))
    ?.querySelector('select')
  if (select) return select as HTMLSelectElement
  // Provider/Credential fields use a <span class="cfg-label"> sibling instead of a wrapping <label>.
  const span = qa<HTMLElement>('.cfg-label').find((s) => s.textContent?.trim().startsWith(label))
  const field = span?.closest('.field')
  const sel = field?.querySelector('select')
  if (!sel) throw new Error(`select not found for label: ${label}`)
  return sel
}

beforeEach(() => {
  vi.mocked(fetchCredentials).mockClear()
  vi.mocked(saveCredential).mockClear()
  vi.mocked(saveConnection).mockClear()
  vi.mocked(fetchOAuthCapabilities).mockClear()
  vi.mocked(startOAuthConnect).mockClear()
  vi.mocked(fetchAvailableModels).mockClear()
  vi.mocked(fetchCredentials).mockResolvedValue({ profiles: [...CREDENTIALS] })
  vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: [] })
  vi.mocked(fetchAvailableModels).mockResolvedValue({ models: [] })
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mountConnectionOnAiProvider(connection: any = null) {
  const w = mount(ConnectionDialog, {
    props: { providers: PROVIDERS, connection },
    attachTo: document.body,
  })
  await flushPromises()
  const aiRadio = q<HTMLInputElement>('input[type="radio"][value="ai-provider"]')
  aiRadio.checked = true
  aiRadio.dispatchEvent(new Event('change'))
  await flushPromises()
  return w
}

function providerSelect(): HTMLSelectElement {
  return selectByLabel(runnerVi.connectionDialog.providerField)
}
function credentialSelect(): HTMLSelectElement {
  return qa<HTMLSelectElement>('select').find((s) =>
    Array.from(s.options).some((o) => o.value === 'cred-anthropic' || o.value === 'cred-gemini'),
  )!
}

async function chooseProvider(providerId: string) {
  const sel = providerSelect()
  sel.value = providerId
  sel.dispatchEvent(new Event('change'))
  await flushPromises()
}
async function chooseCredential(credentialId: string) {
  const sel = credentialSelect()
  sel.value = credentialId
  sel.dispatchEvent(new Event('change'))
  await flushPromises()
}

describe('ConnectionDialog — provider + credential setup (TC-01, TC-10)', () => {
  it('does not require a provider-config picker — providers are always listed and credentials chosen right here', async () => {
    // Clean-state: no credentials configured anywhere yet (TC-10).
    vi.mocked(fetchCredentials).mockResolvedValue({ profiles: [] })
    await mountConnectionOnAiProvider()

    const providers = Array.from(providerSelect().options).map((o) => o.value)
    expect(providers).toEqual(['anthropic-api', 'openai-api', 'gemini-api'])
    expect(document.body.textContent).not.toContain('providerConfig')
  })

  it('saves a connection from an existing provider + credential pair', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await chooseCredential('cred-anthropic')
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.kind).toBe('ai-provider')
    expect(payload.providerId).toBe('anthropic-api')
    expect(payload.credentialId).toBe('cred-anthropic')
    expect(payload.config.baseURL).toBeUndefined()
  })
})

describe('ConnectionDialog — creating a credential inline (TC-02, TC-08)', () => {
  it('opens the "+ Credential" subform and does not navigate away from the connection dialog', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    expect(document.body.textContent).not.toContain('Credential ID')
  })

  it('blocks saving a new credential with neither a secret value nor a secretRef', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))
    expect(saveCredential).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.credentialSecretRequired)
  })

  it('creates the credential with a pasted secret and selects it for this connection (provider had no credentials before)', async () => {
    vi.mocked(fetchCredentials).mockResolvedValueOnce({ profiles: [] })
    await mountConnectionOnAiProvider()
    await chooseProvider('openai-api')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    await setInputValue(q<HTMLInputElement>('input[type="password"]'), 'sk-pasted-secret')
    vi.mocked(fetchCredentials).mockResolvedValueOnce({
      profiles: [{ id: 'minted-id', provider: 'openai-api', label: '', secretRef: '' }],
    })
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))

    expect(saveCredential).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.secretValue).toBe('sk-pasted-secret')
    expect(payload.secretRef).toBeUndefined()
    expect(payload.id).toBeUndefined()

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'New OpenAI conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    const connPayload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(connPayload.credentialId).toBe('minted-id')
    expect(connPayload.providerId).toBe('openai-api')
  })

  it('falls back to the advanced secretRef field when no secret value is pasted', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    const advancedInput = q<HTMLInputElement>('input[placeholder="env:ANTHROPIC_API_KEY"]')
    await setInputValue(advancedInput, 'env:MY_OWN_VAR')
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))

    expect(saveCredential).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.secretRef).toBe('env:MY_OWN_VAR')
    expect(payload.secretValue).toBeUndefined()
  })
})

describe('ConnectionDialog — Connect via browser / OAuth (TC-03)', () => {
  it('hides the button when the provider has no OAuth capability', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.connectViaBrowser)
  })

  it('shows the button once the provider is reported OAuth-capable, and starts the flow on click', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: ['gemini-api'] })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mountConnectionOnAiProvider()
    await chooseProvider('gemini-api')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))

    const connectText = runnerVi.connectionDialog.connectViaBrowser
    expect(document.body.textContent).toContain(connectText)
    await click(buttonByText(connectText))

    expect(startOAuthConnect).toHaveBeenCalledWith('gemini-api', expect.any(String))
    expect(openSpy).toHaveBeenCalledWith('https://example.test/authorize', '_blank', 'noopener')
    openSpy.mockRestore()
  })

  it('hides Connect via browser too when the vault itself is unconfigured, even for an OAuth-capable provider', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: ['gemini-api'], vaultConfigured: false })
    await mountConnectionOnAiProvider()
    await chooseProvider('gemini-api')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))

    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.connectViaBrowser)
  })
})

describe('ConnectionDialog — vault not configured', () => {
  it('warns and disables the secret value field instead of letting the user hit a raw save error', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: [], vaultConfigured: false })
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))

    expect(document.body.textContent).toContain(runnerVi.connectionDialog.vaultNotConfigured)
    expect(q<HTMLInputElement>('input[type="password"]').disabled).toBe(true)
  })
})

describe('ConnectionDialog — Base URL (TC-04)', () => {
  it('always shows the base URL input (no toggle) with the provider default as placeholder', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    const baseUrlInput = q<HTMLInputElement>('input[placeholder="https://api.anthropic.com"]')
    expect(baseUrlInput).toBeTruthy()
  })

  it('saves the connection with the entered base URL', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('gemini-api')
    await chooseCredential('cred-gemini')
    await setInputValue(q<HTMLInputElement>('input[placeholder="https://generativelanguage.googleapis.com/v1beta/openai"]'), 'https://gemini.example/v1')
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Gemini conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.providerId).toBe('gemini-api')
    expect(payload.credentialId).toBe('cred-gemini')
    expect(payload.config.baseURL).toBe('https://gemini.example/v1')
  })
})

describe('ConnectionDialog — validation (TC-05, TC-06, TC-07)', () => {
  it('blocks saving when no provider is selected', async () => {
    await mountConnectionOnAiProvider()
    providerSelect().value = ''
    providerSelect().dispatchEvent(new Event('change'))
    await flushPromises()

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'My conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.providerRequired)
  })

  it('blocks saving when a provider is selected but no credential is chosen or created', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'My conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.credentialRequired)
  })

  it('resets the credential when switching to a provider the chosen credential does not belong to, and blocks saving until a new one is picked', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await chooseCredential('cred-anthropic')

    await chooseProvider('gemini-api')
    // cred-anthropic does not belong to gemini-api — must not carry over.
    expect(credentialSelect().value).toBe('')

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'My conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.credentialRequired)
  })
})

describe('ConnectionDialog — editing an existing connection (TC-09)', () => {
  it('prefills provider, credential and base URL from a previously saved connection', async () => {
    const w = mount(ConnectionDialog, {
      props: {
        providers: PROVIDERS,
        connection: {
          id: 'legacy-api',
          label: 'Legacy API conn',
          kind: 'ai-provider',
          providerId: 'gemini-api',
          credentialId: 'cred-gemini',
          config: { baseURL: 'https://gemini.example/v1' },
        },
      },
      attachTo: document.body,
    })
    await flushPromises()

    expect(providerSelect().value).toBe('gemini-api')
    expect(credentialSelect().value).toBe('cred-gemini')
    expect(q<HTMLInputElement>('input[placeholder="https://generativelanguage.googleapis.com/v1beta/openai"]').value).toBe(
      'https://gemini.example/v1',
    )
    w.unmount()
  })

  it('lets the user edit and re-save without disturbing the existing provider/credential pair', async () => {
    const w = mount(ConnectionDialog, {
      props: {
        providers: PROVIDERS,
        connection: {
          id: 'legacy-api',
          label: 'Legacy API conn',
          kind: 'ai-provider',
          providerId: 'gemini-api',
          credentialId: 'cred-gemini',
          config: { baseURL: 'https://gemini.example/v1' },
        },
      },
      attachTo: document.body,
    })
    await flushPromises()

    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.id).toBe('legacy-api')
    expect(payload.providerId).toBe('gemini-api')
    expect(payload.credentialId).toBe('cred-gemini')
    expect(payload.config.baseURL).toBe('https://gemini.example/v1')
    w.unmount()
  })
})

describe('ConnectionDialog — model list', () => {
  it('renders "Load models" as an icon button, not a text button', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await chooseCredential('cred-anthropic')
    expect(
      qa<HTMLButtonElement>('button').some((b) => b.textContent?.trim() === runnerVi.connectionDialog.loadModels),
    ).toBe(false)
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)
    expect(loadBtn).toBeTruthy()
    expect(loadBtn?.querySelector('svg')).toBeTruthy()
  })

  it('loads models through the selected credential and lets the user pick exactly one', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await chooseCredential('cred-anthropic')
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({ models: ['claude-a', 'claude-b'] })

    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)!
    await click(loadBtn)

    expect(fetchAvailableModels).toHaveBeenCalledWith({
      providerId: 'anthropic-api',
      credentialId: 'cred-anthropic',
      baseURL: undefined,
      secretValue: undefined,
    })

    const comboInput = q<HTMLInputElement>('.c-combo-select .c-combo-input')
    comboInput.dispatchEvent(new Event('focus'))
    await flushPromises()
    const options = qa<HTMLLIElement>('.c-combo-select .c-select-option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['claude-a', 'claude-b'])
    await click(options[0])
    expect(comboInput.value).toBe('claude-a')

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.config.models).toEqual(['claude-a'])
    expect(payload.config.model).toBe('claude-a')
  })

  it('filters the model list live while typing, directly in the select box', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await chooseCredential('cred-anthropic')
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({ models: ['claude-a', 'claude-b'] })
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)!
    await click(loadBtn)

    const comboInput = q<HTMLInputElement>('.c-combo-select .c-combo-input')
    await setInputValue(comboInput, 'claude-a')

    const options = qa<HTMLLIElement>('.c-combo-select .c-select-option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['claude-a'])
    // No separate search input is rendered — filtering happens on the select's own field.
    expect(document.body.querySelector('.c-select-create-input')).toBeNull()
  })

  it('lets the user type a model name that was never in the fetched list', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await chooseCredential('cred-anthropic')

    const comboInput = q<HTMLInputElement>('.c-combo-select .c-combo-input')
    await setInputValue(comboInput, 'my-custom-model')
    comboInput.dispatchEvent(new Event('blur'))
    await flushPromises()

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.config.models).toEqual(['my-custom-model'])
    expect(payload.config.model).toBe('my-custom-model')
  })
})

describe('ConnectionDialog — extra tools (shell/git/search/web)', () => {
  it('defaults to no extra tools checked and omits the key entirely on save', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await chooseCredential('cred-anthropic')
    const checkboxes = qa<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes.every((c) => !c.checked)).toBe(true)

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.config.extraTools).toBeUndefined()
  })

  it('checking shell + web saves both values under config.extraTools', async () => {
    await mountConnectionOnAiProvider()
    await chooseProvider('anthropic-api')
    await chooseCredential('cred-anthropic')
    const shellCheckbox = qa<HTMLInputElement>('input[type="checkbox"][value="shell"]')[0]
    shellCheckbox.checked = true
    shellCheckbox.dispatchEvent(new Event('change'))
    await flushPromises()
    const webCheckbox = qa<HTMLInputElement>('input[type="checkbox"][value="web"]')[0]
    webCheckbox.checked = true
    webCheckbox.dispatchEvent(new Event('change'))
    await flushPromises()

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.config.extraTools).toEqual(['shell', 'web'])
  })

  it('prefills checked extra tools from an edited connection', async () => {
    const w = mount(ConnectionDialog, {
      props: {
        providers: PROVIDERS,
        connection: {
          id: 'conn-with-tools',
          label: 'Conn with tools',
          kind: 'ai-provider',
          providerId: 'anthropic-api',
          credentialId: 'cred-anthropic',
          config: { extraTools: ['git', 'search'] },
        },
      },
      attachTo: document.body,
    })
    await flushPromises()

    expect(qa<HTMLInputElement>('input[type="checkbox"][value="git"]')[0].checked).toBe(true)
    expect(qa<HTMLInputElement>('input[type="checkbox"][value="search"]')[0].checked).toBe(true)
    expect(qa<HTMLInputElement>('input[type="checkbox"][value="shell"]')[0].checked).toBe(false)
    expect(qa<HTMLInputElement>('input[type="checkbox"][value="web"]')[0].checked).toBe(false)
    w.unmount()
  })

  it('a legacy connection with no extraTools key prefills every checkbox unchecked, without error', async () => {
    const w = mount(ConnectionDialog, {
      props: {
        providers: PROVIDERS,
        connection: {
          id: 'legacy-no-tools',
          label: 'Legacy conn',
          kind: 'ai-provider',
          providerId: 'anthropic-api',
          credentialId: 'cred-anthropic',
          config: {},
        },
      },
      attachTo: document.body,
    })
    await flushPromises()

    expect(qa<HTMLInputElement>('input[type="checkbox"]').every((c) => !c.checked)).toBe(true)
    w.unmount()
  })
})
