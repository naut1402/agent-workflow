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
  deleteCredential: vi.fn(async () => ({ deleted: true })),
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
  deleteCredential,
  saveConnection,
  scanLocalCommands,
  fetchOAuthCapabilities,
  startOAuthConnect,
  fetchAvailableModels,
} from '@/features/runner/scripts/ConnectionDialogApi'
import { fetchProviderConfigs, saveProviderConfig, deleteProviderConfig } from '@/features/runner/scripts/ProviderDialogApi'

const PROVIDERS: ProviderEntry[] = [
  { id: 'anthropic-api', kind: 'ai-provider', label: 'Anthropic API', family: 'ai-api' },
  { id: 'openai-api', kind: 'ai-provider', label: 'OpenAI API', family: 'ai-api' },
  { id: 'gemini-api', kind: 'ai-provider', label: 'Gemini API', family: 'ai-api' },
]

const PROVIDER_CONFIGS: ProviderConfigOption[] = [
  { id: 'pc-anthropic', label: 'Anthropic chính', providerId: 'anthropic-api' },
  { id: 'pc-gemini', label: 'Gemini gateway', providerId: 'gemini-api', baseURL: 'https://gemini.example/v1' },
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

beforeEach(() => {
  vi.mocked(fetchCredentials).mockClear()
  vi.mocked(saveCredential).mockClear()
  vi.mocked(deleteCredential).mockClear()
  vi.mocked(saveConnection).mockClear()
  vi.mocked(scanLocalCommands).mockClear()
  vi.mocked(fetchOAuthCapabilities).mockClear()
  vi.mocked(startOAuthConnect).mockClear()
  vi.mocked(fetchAvailableModels).mockClear()
  vi.mocked(fetchProviderConfigs).mockClear()
  vi.mocked(saveProviderConfig).mockClear()
  vi.mocked(deleteProviderConfig).mockClear()
  vi.mocked(fetchCredentials).mockResolvedValue({ profiles: [...CREDENTIALS] })
  vi.mocked(scanLocalCommands).mockResolvedValue({ commands: [] })
  vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: [] })
  vi.mocked(fetchAvailableModels).mockResolvedValue({ models: [] })
  vi.mocked(fetchProviderConfigs).mockResolvedValue({ providerConfigs: [...PROVIDER_CONFIGS] })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
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

const LOCAL_COMMANDS = [
  { id: 'claude', command: 'claude', path: 'claude', available: true, providerId: 'claude-code-cli', flags: [] },
  { id: 'cursor-agent', command: 'cursor-agent', path: 'cursor-agent', available: true, providerId: 'cursor-cli', flags: [] },
]

async function mountConnectionOnLocalConsole(connection: any = null) {
  vi.mocked(scanLocalCommands).mockResolvedValue({ commands: LOCAL_COMMANDS })
  const w = mount(ConnectionDialog, {
    props: { providers: PROVIDERS, providerConfigs: PROVIDER_CONFIGS, connection },
    attachTo: document.body,
  })
  await flushPromises()
  return w
}

function commandSelectRoot(): HTMLElement {
  return cSelectRootByLabel('Command')
}
async function chooseCommand(label: string) {
  await pickCSelectOption(commandSelectRoot(), label)
}

async function mountConnectionOnAiProvider(connection: any = null, providerConfigs = PROVIDER_CONFIGS) {
  const w = mount(ConnectionDialog, {
    props: { providers: PROVIDERS, providerConfigs, connection },
    attachTo: document.body,
  })
  await flushPromises()
  const aiRadio = q<HTMLInputElement>('input[type="radio"][value="ai-provider"]')
  aiRadio.checked = true
  aiRadio.dispatchEvent(new Event('change'))
  await flushPromises()
  return w
}

// The provider-config/credential/interface pickers migrated from native
// `<select>` to `CSelect` (task 20260826_001) — there's no `<select>` DOM node
// or `.value` to read/set directly anymore. These helpers drive `CSelect`'s
// actual DOM instead: find the `.c-select` root by its `aria-label`, click the
// trigger to open the menu, then click the `<li>` whose text matches the
// option's label.
function cSelectRootByLabel(ariaLabel: string): HTMLElement {
  const el = qa<HTMLElement>('.c-select').find(
    (root) => root.querySelector('.c-select-trigger')?.getAttribute('aria-label') === ariaLabel,
  )
  if (!el) throw new Error(`CSelect not found: ${ariaLabel}`)
  return el
}
function cSelectValueText(root: HTMLElement): string {
  return root.querySelector('.c-select-value')!.textContent!.trim()
}
async function pickCSelectOption(root: HTMLElement, optionLabel: string) {
  await click(root.querySelector('.c-select-trigger')!)
  const option = qa<HTMLLIElement>('.c-select-option').find((li) => li.textContent?.trim() === optionLabel)
  if (!option) throw new Error(`option not found: ${optionLabel}`)
  await click(option)
}
function providerConfigSelectRoot(): HTMLElement {
  return cSelectRootByLabel(runnerVi.connectionDialog.providerField)
}
function credentialSelectRoot(): HTMLElement {
  return cSelectRootByLabel(runnerVi.connectionDialog.credentialField)
}
function providerConfigLabelOf(id: string): string {
  const pc = PROVIDER_CONFIGS.find((p) => p.id === id)!
  return `${pc.label} (${pc.providerId})`
}
function credentialLabelOf(id: string): string {
  return CREDENTIALS.find((c) => c.id === id)!.label
}
async function chooseProviderConfig(id: string) {
  await pickCSelectOption(providerConfigSelectRoot(), providerConfigLabelOf(id))
}
async function chooseCredential(credentialId: string) {
  await pickCSelectOption(credentialSelectRoot(), credentialLabelOf(credentialId))
}

describe('ProviderDialog — provider config (no credential)', () => {
  it('does not render any credential field', async () => {
    await mountProviderDialog()
    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.credentialField)
    expect(document.body.querySelector('input[type="password"]')).toBeNull()
  })

  it('requires a label and an interface before saving', async () => {
    await mountProviderDialog()
    await click(buttonByText(runnerVi.providerDialog.save))
    expect(saveProviderConfig).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.providerDialog.labelRequired)
  })

  it('saves label + interface + base URL', async () => {
    await mountProviderDialog()
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. OpenAI gateway của tôi"]'), 'My gateway')
    await pickCSelectOption(cSelectRootByLabel(runnerVi.providerDialog.interfaceField), 'Gemini API')
    await setInputValue(
      q<HTMLInputElement>('input[placeholder="https://generativelanguage.googleapis.com/v1beta/openai"]'),
      'https://gemini.example/v1',
    )
    await click(buttonByText(runnerVi.providerDialog.save))

    expect(saveProviderConfig).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveProviderConfig).mock.calls[0][0] as any
    expect(payload.providerId).toBe('gemini-api')
    expect(payload.label).toBe('My gateway')
    expect(payload.baseURL).toBe('https://gemini.example/v1')
    expect(payload.credentialId).toBeUndefined()
  })

  it('prefills from an edited provider config', async () => {
    await mountProviderDialog(PROVIDER_CONFIGS[1])
    const labelInput = q<HTMLInputElement>('input[placeholder="vd. OpenAI gateway của tôi"]')
    expect(labelInput.value).toBe('Gemini gateway')
    expect(cSelectValueText(cSelectRootByLabel(runnerVi.providerDialog.interfaceField))).toBe('Gemini API')
    const baseUrlInput = qa<HTMLInputElement>('.field input').find((i) => i.value === 'https://gemini.example/v1')
    expect(baseUrlInput).toBeTruthy()
  })
})

describe('ConnectionDialog — provider config picker', () => {
  it('lists configured provider configs, not raw interfaces', async () => {
    await mountConnectionOnAiProvider()
    const root = providerConfigSelectRoot()
    await click(root.querySelector('.c-select-trigger')!)
    const labels = qa<HTMLLIElement>('.c-select-option').map((li) => li.textContent?.trim())
    expect(labels).toEqual(
      expect.arrayContaining([providerConfigLabelOf('pc-anthropic'), providerConfigLabelOf('pc-gemini')]),
    )
  })

  it('opens ProviderDialog via the "+" button next to the provider picker', async () => {
    await mountConnectionOnAiProvider()
    await click(buttonByTitle(runnerVi.providerDialog.title))
    expect(document.body.textContent).toContain(runnerVi.providerDialog.labelField)
  })

  it('blocks saving when no provider config is selected', async () => {
    // No `CSelect` option can express "unset" once one has been auto-picked, so
    // start from an empty catalog instead of forcing '' onto a native select.
    await mountConnectionOnAiProvider(null, [])

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'My conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.providerConfigRequired)
  })
})

describe('ConnectionDialog — provider + credential setup', () => {
  it('saves a connection using providerId/baseURL from the provider config and the chosen credential', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await chooseCredential('cred-anthropic')
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude API conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.kind).toBe('ai-provider')
    expect(payload.providerId).toBe('anthropic-api')
    expect(payload.credentialId).toBe('cred-anthropic')
    expect(payload.config.providerConfigId).toBe('pc-anthropic')
    expect(payload.config.baseURL).toBeUndefined()
  })

  it('copies the provider config base URL into the saved connection', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-gemini')
    await chooseCredential('cred-gemini')
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Gemini conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.providerId).toBe('gemini-api')
    expect(payload.credentialId).toBe('cred-gemini')
    expect(payload.config.baseURL).toBe('https://gemini.example/v1')
  })
})

describe('ConnectionDialog — creating a credential inline', () => {
  it('opens the "+ Credential" subform and does not navigate away from the connection dialog', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    expect(document.body.textContent).not.toContain('Credential ID')
  })

  it('blocks saving a new credential with neither a secret value nor a secretRef', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))
    expect(saveCredential).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.credentialSecretRequired)
  })

  it('creates the credential with a pasted secret and selects it for this connection', async () => {
    vi.mocked(fetchCredentials).mockResolvedValueOnce({ profiles: [] })
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    await setInputValue(q<HTMLInputElement>('input[type="password"]'), 'sk-pasted-secret')
    vi.mocked(fetchCredentials).mockResolvedValueOnce({
      profiles: [{ id: 'minted-id', provider: 'anthropic-api', label: '', secretRef: '' }],
    })
    await click(buttonByText(runnerVi.connectionDialog.saveCredential))

    expect(saveCredential).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.secretValue).toBe('sk-pasted-secret')
    expect(payload.secretRef).toBeUndefined()
    expect(payload.id).toBeUndefined()

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'New conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    const connPayload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(connPayload.credentialId).toBe('minted-id')
    expect(connPayload.providerId).toBe('anthropic-api')
  })

  it('falls back to the advanced secretRef field when no secret value is pasted', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
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

describe('ConnectionDialog — deleting a provider config', () => {
  it('disables the delete button until a provider config is selected', async () => {
    await mountConnectionOnAiProvider(null, [])
    expect(buttonByTitle(runnerVi.connectionDialog.deleteProvider).disabled).toBe(true)
  })

  it('deletes the selected provider config after confirming, then refreshes the list', async () => {
    vi.mocked(fetchProviderConfigs).mockResolvedValueOnce({ providerConfigs: [PROVIDER_CONFIGS[1]] })
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.deleteProvider))

    expect(deleteProviderConfig).toHaveBeenCalledWith('pc-anthropic')
    expect(cSelectValueText(providerConfigSelectRoot())).toBe(providerConfigLabelOf('pc-gemini'))
  })

  it('does nothing when the user cancels the confirmation', async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.deleteProvider))
    expect(deleteProviderConfig).not.toHaveBeenCalled()
  })
})

describe('ConnectionDialog — editing a credential', () => {
  it('disables edit/delete until a credential is selected', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    expect(buttonByTitle(runnerVi.connectionDialog.editCredential).disabled).toBe(true)
    expect(buttonByTitle(runnerVi.connectionDialog.deleteCredential).disabled).toBe(true)
  })

  it('opens the subform prefilled with the label, without prefilling any secret', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await chooseCredential('cred-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.editCredential))

    const labelInput = qa<HTMLInputElement>('.new-cred input').find((i) => i.value === 'Anthropic chính')
    expect(labelInput).toBeTruthy()
    expect(q<HTMLInputElement>('input[type="password"]').value).toBe('')
  })

  it('saves the edit, keeping the existing secretRef when no new secret is entered', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await chooseCredential('cred-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.editCredential))
    await click(buttonByText(runnerVi.actions.save))

    expect(saveCredential).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.id).toBe('cred-anthropic')
    expect(payload.secretRef).toBe('vault:cred-anthropic')
    expect(payload.secretValue).toBeUndefined()
  })

  it('replaces the secret when a new one is pasted while editing', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await chooseCredential('cred-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.editCredential))
    await setInputValue(q<HTMLInputElement>('input[type="password"]'), 'sk-new-secret')
    await click(buttonByText(runnerVi.actions.save))

    const payload = vi.mocked(saveCredential).mock.calls[0][0] as any
    expect(payload.id).toBe('cred-anthropic')
    expect(payload.secretValue).toBe('sk-new-secret')
    expect(payload.secretRef).toBeUndefined()
  })
})

describe('ConnectionDialog — deleting a credential', () => {
  it('deletes the selected credential after confirming, then clears the selection', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await chooseCredential('cred-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.deleteCredential))

    expect(deleteCredential).toHaveBeenCalledWith('cred-anthropic')
    expect(cSelectValueText(credentialSelectRoot())).toBe(runnerVi.connectionDialog.credentialPlaceholder)
  })

  it('does nothing when the user cancels the confirmation', async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await chooseCredential('cred-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.deleteCredential))
    expect(deleteCredential).not.toHaveBeenCalled()
  })
})

describe('ConnectionDialog — Connect via browser (OAuth)', () => {
  it('hides the button when the provider has no OAuth capability', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))
    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.connectViaBrowser)
  })

  it('shows the button once the provider is reported OAuth-capable, and starts the flow on click', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: ['gemini-api'] })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-gemini')
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
    await chooseProviderConfig('pc-gemini')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))

    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.connectViaBrowser)
  })
})

describe('ConnectionDialog — vault not configured', () => {
  it('warns and disables the secret value field instead of letting the user hit a raw save error', async () => {
    vi.mocked(fetchOAuthCapabilities).mockResolvedValue({ providers: [], vaultConfigured: false })
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await click(buttonByTitle(runnerVi.connectionDialog.addCredential))

    expect(document.body.textContent).toContain(runnerVi.connectionDialog.vaultNotConfigured)
    expect(q<HTMLInputElement>('input[type="password"]').disabled).toBe(true)
  })
})

describe('ConnectionDialog — validation', () => {
  it('blocks saving when a provider config is selected but no credential is chosen or created', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'My conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.credentialRequired)
  })

  it('resets the credential when switching to a provider config whose provider the chosen credential does not belong to', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await chooseCredential('cred-anthropic')

    await chooseProviderConfig('pc-gemini')
    // cred-anthropic does not belong to gemini-api — must not carry over.
    expect(cSelectValueText(credentialSelectRoot())).toBe(runnerVi.connectionDialog.credentialPlaceholder)

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'My conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(runnerVi.errors.credentialRequired)
  })
})

describe('ConnectionDialog — editing an existing connection', () => {
  it('prefills the provider config (by providerConfigId link) and credential from a previously saved connection', async () => {
    const w = mount(ConnectionDialog, {
      props: {
        providers: PROVIDERS,
        providerConfigs: PROVIDER_CONFIGS,
        connection: {
          id: 'existing-api',
          label: 'Existing conn',
          kind: 'ai-provider',
          providerId: 'gemini-api',
          credentialId: 'cred-gemini',
          config: { providerConfigId: 'pc-gemini' },
        },
      },
      attachTo: document.body,
    })
    await flushPromises()

    expect(cSelectValueText(providerConfigSelectRoot())).toBe(providerConfigLabelOf('pc-gemini'))
    expect(cSelectValueText(credentialSelectRoot())).toBe(credentialLabelOf('cred-gemini'))
    w.unmount()
  })

  it('matches on providerId when no providerConfigId link exists', async () => {
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

    expect(cSelectValueText(providerConfigSelectRoot())).toBe(providerConfigLabelOf('pc-gemini'))
    expect(cSelectValueText(credentialSelectRoot())).toBe(credentialLabelOf('cred-gemini'))
    w.unmount()
  })

  it('lets the user edit and re-save without disturbing the existing provider/credential pair', async () => {
    const w = mount(ConnectionDialog, {
      props: {
        providers: PROVIDERS,
        providerConfigs: PROVIDER_CONFIGS,
        connection: {
          id: 'existing-api',
          label: 'Existing conn',
          kind: 'ai-provider',
          providerId: 'gemini-api',
          credentialId: 'cred-gemini',
          config: { providerConfigId: 'pc-gemini' },
        },
      },
      attachTo: document.body,
    })
    await flushPromises()

    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.id).toBe('existing-api')
    expect(payload.providerId).toBe('gemini-api')
    expect(payload.credentialId).toBe('cred-gemini')
    expect(payload.config.baseURL).toBe('https://gemini.example/v1')
    w.unmount()
  })
})

describe('ConnectionDialog — model list', () => {
  it('renders "Load models" as an icon button, not a text button', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
    await chooseCredential('cred-anthropic')
    expect(
      qa<HTMLButtonElement>('button').some((b) => b.textContent?.trim() === runnerVi.connectionDialog.loadModels),
    ).toBe(false)
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)
    expect(loadBtn).toBeTruthy()
    expect(loadBtn?.querySelector('svg')).toBeTruthy()
  })

  it('loads models through the selected provider config + credential and lets the user pick exactly one', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
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
    expect(payload.config.providerConfigId).toBe('pc-anthropic')
  })

  it('filters the model list live while typing, directly in the select box', async () => {
    await mountConnectionOnAiProvider()
    await chooseProviderConfig('pc-anthropic')
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
    await chooseProviderConfig('pc-anthropic')
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
    await chooseProviderConfig('pc-anthropic')
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
    await chooseProviderConfig('pc-anthropic')
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
        providerConfigs: PROVIDER_CONFIGS,
        connection: {
          id: 'conn-with-tools',
          label: 'Conn with tools',
          kind: 'ai-provider',
          providerId: 'anthropic-api',
          credentialId: 'cred-anthropic',
          config: { providerConfigId: 'pc-anthropic', extraTools: ['git', 'search'] },
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
        providerConfigs: PROVIDER_CONFIGS,
        connection: {
          id: 'legacy-no-tools',
          label: 'Legacy conn',
          kind: 'ai-provider',
          providerId: 'anthropic-api',
          credentialId: 'cred-anthropic',
          config: { providerConfigId: 'pc-anthropic' },
        },
      },
      attachTo: document.body,
    })
    await flushPromises()

    expect(qa<HTMLInputElement>('input[type="checkbox"]').every((c) => !c.checked)).toBe(true)
    w.unmount()
  })
})

describe('ConnectionDialog — local-console model (claude-code-cli)', () => {
  it('shows the model field + reload button when claude is the selected command, without needing a credential', async () => {
    await mountConnectionOnLocalConsole()
    expect(document.body.textContent).toContain(runnerVi.connectionDialog.modelField)
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)
    expect(loadBtn).toBeTruthy()
    expect(loadBtn?.disabled).toBe(false)
  })

  it('reload fetches the static claude-code-cli model list without baseURL/credentialId', async () => {
    await mountConnectionOnLocalConsole()
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({ models: ['opus', 'sonnet', 'haiku'] })

    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)!
    await click(loadBtn)

    expect(fetchAvailableModels).toHaveBeenCalledWith({ providerId: 'claude-code-cli' })
    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.noModelsFound)
  })

  it('hides the model field for a non-claude local command (e.g. cursor-agent)', async () => {
    await mountConnectionOnLocalConsole()
    await chooseCommand('cursor-agent')
    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.modelField)
  })

  it('selecting a model and saving persists it under config.model for the claude connection', async () => {
    await mountConnectionOnLocalConsole()
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({ models: ['opus', 'sonnet', 'haiku'] })
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)!
    await click(loadBtn)

    const comboInput = q<HTMLInputElement>('.c-combo-select .c-combo-input')
    comboInput.dispatchEvent(new Event('focus'))
    await flushPromises()
    const option = qa<HTMLLIElement>('.c-combo-select .c-select-option').find((o) => o.textContent?.trim() === 'opus')!
    await click(option)

    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude local conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.kind).toBe('local-console')
    expect(payload.providerId).toBe('claude-code-cli')
    expect(payload.config).toEqual({ model: 'opus' })
  })

  it('saving without picking a model works exactly as before (no config.model)', async () => {
    await mountConnectionOnLocalConsole()
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Claude local conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.config).toBeUndefined()
  })

  it('switching from claude to a non-claude command before saving does not leak the chosen model', async () => {
    await mountConnectionOnLocalConsole()
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({ models: ['opus', 'sonnet', 'haiku'] })
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)!
    await click(loadBtn)
    const comboInput = q<HTMLInputElement>('.c-combo-select .c-combo-input')
    comboInput.dispatchEvent(new Event('focus'))
    await flushPromises()
    const option = qa<HTMLLIElement>('.c-combo-select .c-select-option').find((o) => o.textContent?.trim() === 'opus')!
    await click(option)

    await chooseCommand('cursor-agent')
    await setInputValue(q<HTMLInputElement>('input[placeholder="vd. Claude local"]'), 'Cursor conn')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))

    expect(saveConnection).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.providerId).toBe('cursor-cli')
    expect(payload.config).toBeUndefined()
  })

  it('editing a pre-existing claude connection prefills its saved model', async () => {
    const w = await mountConnectionOnLocalConsole({
      id: 'claude-local',
      label: 'Claude local',
      kind: 'local-console',
      providerId: 'claude-code-cli',
      cliPath: 'claude',
      flags: [],
      config: { model: 'sonnet' },
    })

    const comboInput = q<HTMLInputElement>('.c-combo-select .c-combo-input')
    expect(comboInput.value).toBe('sonnet')
    w.unmount()
  })

  it('editing a legacy claude connection with no model configured opens without error and stays unset', async () => {
    const w = await mountConnectionOnLocalConsole({
      id: 'claude-local',
      label: 'Claude local',
      kind: 'local-console',
      providerId: 'claude-code-cli',
      cliPath: 'claude',
      flags: [],
    })

    const comboInput = q<HTMLInputElement>('.c-combo-select .c-combo-input')
    expect(comboInput.value).toBe('')
    await click(buttonByText(runnerVi.connectionDialog.saveConnection))
    const payload = vi.mocked(saveConnection).mock.calls[0][0] as any
    expect(payload.config).toBeUndefined()
    w.unmount()
  })

  it('switching commands clears the previously fetched model list (no stale options)', async () => {
    await mountConnectionOnLocalConsole()
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({ models: ['opus', 'sonnet', 'haiku'] })
    const loadBtn = qa<HTMLButtonElement>('button').find((b) => b.title === runnerVi.connectionDialog.loadModels)!
    await click(loadBtn)
    const loadedText = runnerVi.connectionDialog.modelsLoaded.replace('{count}', '3')
    expect(document.body.textContent).toContain(loadedText)

    await chooseCommand('cursor-agent')
    expect(document.body.textContent).not.toContain(runnerVi.connectionDialog.modelField)

    await chooseCommand('claude')
    expect(document.body.textContent).not.toContain(loadedText)
  })
})
