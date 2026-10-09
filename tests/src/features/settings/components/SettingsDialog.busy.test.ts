import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mountWithI18n as mount, createTestI18n } from '../../../helpers/i18n'
import SettingsDialog from '@/features/settings/components/SettingsDialog.vue'
import { useAppSettings } from '@/frontend/composables/useAppSettings'
import type { ModeEntry } from '@/frontend/shell/modeRegistry'

vi.mock('@/features/settings/scripts/SettingsDialogApi', () => ({
  fetchAutoscanConfig: vi.fn(),
  saveAutoscanConfig: vi.fn(),
  runAutoscan: vi.fn(),
  fetchGithubTokensConfig: vi.fn(),
  saveGithubTokensConfig: vi.fn(),
  fetchLoggingConfig: vi.fn(),
  saveLoggingConfig: vi.fn(),
  fetchModesConfig: vi.fn(),
  saveModesConfig: vi.fn(),
  fetchRecoveryConfig: vi.fn(),
  saveRecoveryConfig: vi.fn(),
  fetchScanPatternsConfig: vi.fn(),
  saveScanPatternsConfig: vi.fn(),
}))

import {
  fetchAutoscanConfig,
  fetchGithubTokensConfig,
  fetchLoggingConfig,
  fetchModesConfig,
  fetchRecoveryConfig,
  fetchScanPatternsConfig,
  runAutoscan,
  saveAutoscanConfig,
  saveGithubTokensConfig,
  saveLoggingConfig,
  saveModesConfig,
  saveRecoveryConfig,
  saveScanPatternsConfig,
} from '@/features/settings/scripts/SettingsDialogApi'

const i18n = createTestI18n('vi')
const t = (key: string) => (i18n.global.t as any)(key)

const LOGGING = {
  showLogsTab: true,
  types: { audit: true, request: true, jobs: true, events: false, usage: true },
}

function hold<T>() {
  let release!: (v: T) => void
  const promise = new Promise<T>((r) => {
    release = r
  })
  return { promise, release }
}

const echo = async (c: object) => ({ config: c })

function mode(key: string, extra: Partial<ModeEntry> = {}): ModeEntry {
  return {
    key,
    labelKey: `common.modes.${key}`,
    icon: 'monitor',
    order: 1,
    statusKind: 'paused',
    panel: { name: 'Stub', template: '<div />' },
    maturity: 'stable',
    ...extra,
  } as ModeEntry
}

const CATALOG = [mode('monitor', { alwaysOn: true }), mode('knowledge'), mode('logs'), mode('statistics')]

beforeEach(() => {
  localStorage.clear()
  useAppSettings().load()
  vi.mocked(fetchAutoscanConfig).mockResolvedValue({ config: { enabled: false, whitelist: ['/repo/a'] } })
  vi.mocked(fetchGithubTokensConfig).mockResolvedValue({ config: { repos: [{ repo: 'acme/app', token: 'ghp_old' }] } })
  vi.mocked(fetchLoggingConfig).mockResolvedValue({ config: LOGGING })
  vi.mocked(fetchModesConfig).mockResolvedValue({ config: { enabled: {} } })
  vi.mocked(fetchRecoveryConfig).mockResolvedValue({ config: { enabled: true, maxAttempts: 3 } })
  vi.mocked(fetchScanPatternsConfig).mockResolvedValue({ config: { agents: [], skills: [], rules: [] } })
  vi.mocked(saveAutoscanConfig).mockImplementation(echo)
  vi.mocked(saveGithubTokensConfig).mockImplementation(echo)
  vi.mocked(saveLoggingConfig).mockImplementation(echo)
  vi.mocked(saveModesConfig).mockImplementation(echo)
  vi.mocked(saveRecoveryConfig).mockImplementation(echo)
  vi.mocked(saveScanPatternsConfig).mockImplementation(echo)
  vi.mocked(runAutoscan).mockResolvedValue({ report: { added: [], existing: [] } })
})

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  useAppSettings().load()
  vi.clearAllMocks()
})

async function open(group?: string) {
  mount(SettingsDialog, { attachTo: document.body, props: { modeCatalog: CATALOG } })
  await flushPromises()
  if (group) {
    ;(document.querySelector(`.settings-nav-item[data-group="${group}"]`) as HTMLButtonElement).click()
    await flushPromises()
  }
}

function checkboxByLabel(text: string): HTMLInputElement {
  const label = [...document.querySelectorAll('.settings-pane label')].find((l) =>
    l.textContent?.includes(text),
  )
  const input = label?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
  if (!input) throw new Error(`checkbox not found: ${text}`)
  return input
}

function fireChange(el: HTMLInputElement) {
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function pressEnter(el: HTMLInputElement) {
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
}

function typeInto(el: HTMLInputElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const overlay = () => document.querySelector('.settings-layout.c-loading-host > .c-loading-overlay')

describe('SettingsDialog — lưu đang chạy chặn thao tác ghi', () => {
  it('TC-30: overlay neo ở .settings-layout (không cuộn), bật khi lưu đang chạy và tắt khi xong', async () => {
    const pending = hold<{ config: object }>()
    vi.mocked(saveLoggingConfig).mockReturnValueOnce(pending.promise)
    await open()

    const host = document.querySelector('.settings-layout') as HTMLElement
    expect(host.classList.contains('c-loading-host')).toBe(true)
    expect(host.querySelector(':scope > .settings-pane.modal-body')).not.toBeNull()
    expect(overlay()).toBeNull()

    fireChange(checkboxByLabel(t('settings.logging.showTab')))
    await nextTick()
    expect(overlay()).not.toBeNull()
    expect(checkboxByLabel(t('settings.logging.showTab')).disabled).toBe(true)

    pending.release({ config: { ...LOGGING, showLogsTab: false } })
    await flushPromises()
    expect(overlay()).toBeNull()
  })

  it('TC-31: logging — đổi cờ khác khi đang lưu bị bỏ qua, không lật state cục bộ', async () => {
    const pending = hold<{ config: object }>()
    vi.mocked(saveLoggingConfig).mockReturnValueOnce(pending.promise)
    await open()

    fireChange(checkboxByLabel('Jobs'))
    await nextTick()
    fireChange(checkboxByLabel('Audit'))
    await nextTick()
    expect(saveLoggingConfig).toHaveBeenCalledTimes(1)
    expect(checkboxByLabel('Audit').checked).toBe(true)

    pending.release({ config: { ...LOGGING, types: { ...LOGGING.types, jobs: false } } })
    await flushPromises()

    fireChange(checkboxByLabel('Request'))
    await flushPromises()
    expect(saveLoggingConfig).toHaveBeenCalledTimes(2)
    expect(vi.mocked(saveLoggingConfig).mock.calls[1][0]).toEqual({
      showLogsTab: true,
      types: { audit: true, request: false, jobs: false, events: false, usage: true },
    })
  })

  it('TC-32: modes — bật/tắt mode thứ hai khi mode đầu đang lưu không gửi request', async () => {
    const pending = hold<{ config: object }>()
    vi.mocked(saveModesConfig).mockReturnValueOnce(pending.promise)
    await open('modes')

    const boxes = [...document.querySelectorAll('.settings-mode-row input[type="checkbox"]')] as HTMLInputElement[]
    fireChange(boxes[1])
    await nextTick()
    fireChange(boxes[2])
    await nextTick()
    expect(saveModesConfig).toHaveBeenCalledTimes(1)
    expect(saveModesConfig).toHaveBeenCalledWith({ enabled: { knowledge: false } })

    pending.release({ config: { enabled: { knowledge: false } } })
    await flushPromises()
    expect(boxes[2].disabled).toBe(false)
  })

  it('TC-33: recovery — bấm lặp khi đang lưu chỉ gửi một request', async () => {
    const pending = hold<{ config: object }>()
    vi.mocked(saveRecoveryConfig).mockReturnValueOnce(pending.promise)
    await open()

    const box = checkboxByLabel(t('settings.recovery.enabled'))
    fireChange(box)
    await nextTick()
    fireChange(box)
    await nextTick()
    expect(saveRecoveryConfig).toHaveBeenCalledTimes(1)
    expect(saveRecoveryConfig).toHaveBeenCalledWith({ enabled: false, maxAttempts: 3 })

    pending.release({ config: { enabled: false, maxAttempts: 3 } })
    await flushPromises()
  })

  it('TC-34: autoscan — scanNow và lưu whitelist dùng chung một cờ; thao tác khi đang quét bị bỏ qua', async () => {
    const pending = hold<{ report: object }>()
    vi.mocked(runAutoscan).mockReturnValueOnce(pending.promise as any)
    await open('projects')

    const scanBtn = [...document.querySelectorAll('.settings-autoscan-actions button')][0] as HTMLButtonElement
    scanBtn.click()
    await flushPromises()
    expect(saveAutoscanConfig).toHaveBeenCalledTimes(1)
    expect(overlay()).not.toBeNull()

    fireChange(checkboxByLabel(t('settings.autoscan.enabled')))
    await nextTick()
    const draft = document.querySelector('.settings-whitelist-add input') as HTMLInputElement
    typeInto(draft, '/repo/b')
    pressEnter(draft)
    await nextTick()
    expect(saveAutoscanConfig).toHaveBeenCalledTimes(1)

    pending.release({ report: { added: [], existing: [] } })
    await flushPromises()
    const paths = [...document.querySelectorAll('.settings-whitelist-path')].map((e) => e.textContent)
    expect(paths).toContain('/repo/a')
    expect(paths).not.toContain('/repo/b')
    expect(checkboxByLabel(t('settings.autoscan.enabled')).disabled).toBe(false)
  })

  it('TC-35: scan patterns — thêm pattern khi đang lưu bị bỏ qua, danh sách không đổi', async () => {
    const pending = hold<{ config: object }>()
    vi.mocked(saveScanPatternsConfig).mockReturnValueOnce(pending.promise)
    await open('projects')

    const block = (kind: string) =>
      document.querySelector(`.settings-scan-patterns .settings-subsection[data-kind="${kind}"]`) as HTMLElement
    const agentsInput = block('agents').querySelector('input') as HTMLInputElement
    typeInto(agentsInput, '.agents/*.md')
    pressEnter(agentsInput)
    await nextTick()

    const rulesInput = block('rules').querySelector('input') as HTMLInputElement
    typeInto(rulesInput, 'docs/rules/*.md')
    pressEnter(rulesInput)
    await nextTick()
    expect(saveScanPatternsConfig).toHaveBeenCalledTimes(1)
    expect(block('rules').querySelector('.settings-whitelist-item')).toBeNull()

    pending.release({ config: { agents: ['.agents/*.md'], skills: [], rules: [] } })
    await flushPromises()
    expect(block('rules').textContent).not.toContain('docs/rules/*.md')
    expect(rulesInput.value).toBe('docs/rules/*.md')
  })

  it('TC-36: github tokens — lưu bản nháp khi đang lưu bị bỏ qua, bản nháp còn nguyên', async () => {
    const pending = hold<{ config: object }>()
    vi.mocked(saveGithubTokensConfig).mockReturnValueOnce(pending.promise)
    await open('projects')

    const [repoInput, tokenInput] = [
      ...document.querySelectorAll('.settings-github-tokens-add input'),
    ] as HTMLInputElement[]
    typeInto(repoInput, 'acme/web')
    typeInto(tokenInput, 'ghp_web')
    pressEnter(tokenInput)
    await nextTick()
    expect(saveGithubTokensConfig).toHaveBeenCalledTimes(1)

    typeInto(repoInput, 'acme/api')
    typeInto(tokenInput, 'ghp_api')
    pressEnter(tokenInput)
    await nextTick()
    expect(saveGithubTokensConfig).toHaveBeenCalledTimes(1)

    pending.release({
      config: {
        repos: [
          { repo: 'acme/app', token: 'ghp_old' },
          { repo: 'acme/web', token: 'ghp_web' },
        ],
      },
    })
    await flushPromises()
    const repos = [...document.querySelectorAll('.settings-github-tokens .settings-whitelist-path')].map(
      (e) => e.textContent,
    )
    expect(repos).toEqual(['acme/app', 'acme/web'])
    expect(repoInput.value).toBe('acme/api')
  })
})
