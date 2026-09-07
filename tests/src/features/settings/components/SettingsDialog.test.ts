import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import SettingsDialog from '@/features/settings/components/SettingsDialog.vue'
import {
  STORAGE_KEY,
  useAppSettings,
} from '@/core/composables/useAppSettings'

vi.mock('@/features/settings/scripts/SettingsDialogApi', () => ({
  fetchAutoscanConfig: vi.fn(async () => ({
    config: { enabled: false, whitelist: [], intervalMs: 60_000 },
  })),
  saveAutoscanConfig: vi.fn(async (c: object) => ({ config: c })),
  runAutoscan: vi.fn(async () => ({
    report: { added: [], existing: [], skipped: [], errors: [], hits: [], scanned: 0 },
  })),
  fetchGithubTokensConfig: vi.fn(async () => ({
    config: { repos: [{ repo: 'acme/app', token: 'ghp_old' }] },
  })),
  saveGithubTokensConfig: vi.fn(async (c: object) => ({ config: c })),
  fetchLoggingConfig: vi.fn(async () => ({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
    },
  })),
  saveLoggingConfig: vi.fn(async (c: object) => ({ config: c })),
  fetchScanPatternsConfig: vi.fn(async () => ({
    config: { agents: [], skills: [], rules: [] },
  })),
  saveScanPatternsConfig: vi.fn(async (c: object) => ({ config: c })),
}))

import {
  fetchLoggingConfig,
  saveLoggingConfig,
  saveScanPatternsConfig,
} from '@/features/settings/scripts/SettingsDialogApi'

beforeEach(() => {
  localStorage.clear()
  const { load } = useAppSettings()
  load()
})

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  const { load } = useAppSettings()
  load()
  vi.mocked(fetchLoggingConfig).mockReset()
  vi.mocked(saveLoggingConfig).mockReset()
  vi.mocked(fetchLoggingConfig).mockResolvedValue({
    config: {
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
    },
  })
  vi.mocked(saveLoggingConfig).mockImplementation(async (c: object) => ({ config: c }))
  vi.mocked(saveScanPatternsConfig).mockClear()
})

describe('SettingsDialog', () => {
  it('TC-U-01: nav General + all sections visible on pane', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const nav = document.querySelector('.settings-nav') as HTMLElement
    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(nav).toBeTruthy()
    expect(pane).toBeTruthy()
    expect(nav.textContent).toContain('Chung')
    expect(nav.textContent).toContain('Projects')
    expect(
      document.querySelector('.settings-nav-item.active[data-group="general"]'),
    ).toBeTruthy()
    const text = pane.textContent ?? ''
    expect(text).toContain('Giao diện')
    expect(text).toContain('Ngôn ngữ')
    expect(text).toContain('Artifact')
    expect(text).toContain('Danh sách task')
    expect(text).toContain('Sidebar')
    expect(text).toContain('Logs')
    expect(text).not.toContain('Autoscan')
  })

  it('logging section: shows type checkboxes when showLogsTab on; hides when off and persists', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    await flushPromises()

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(pane.textContent).toContain('Hiện tab Logs')
    expect(pane.textContent).toContain('Audit')
    expect(pane.textContent).toContain('Request')
    expect(pane.textContent).toContain('Jobs')
    expect(pane.textContent).toContain('Events')

    const checkboxes = Array.from(
      pane.querySelectorAll('.settings-section .settings-checkbox input[type="checkbox"]'),
    ) as HTMLInputElement[]
    // General group also has sidebar collapse checkboxes; logging block is last section with showTab + 4 types
    const showLogs = checkboxes.find((el) =>
      el.closest('label')?.textContent?.includes('Hiện tab Logs'),
    )
    expect(showLogs).toBeTruthy()
    expect(showLogs!.checked).toBe(true)

    showLogs!.checked = false
    showLogs!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(saveLoggingConfig).toHaveBeenCalledWith({
      showLogsTab: false,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
    })
    expect(pane.textContent).not.toContain('Loại log')
    expect(pane.textContent).not.toContain('Audit (thay đổi cấu hình)')
  })

  it('logging section: loads prefs from API (showLogsTab false hides types)', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValueOnce({
      config: {
        showLogsTab: false,
        types: { audit: false, request: true, jobs: false, events: false, usage: true },
      },
    })
    mount(SettingsDialog, { attachTo: document.body })
    await flushPromises()

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(pane.textContent).toContain('Hiện tab Logs')
    expect(pane.textContent).not.toContain('Loại log')
    const showLogs = Array.from(pane.querySelectorAll('label.settings-checkbox')).find((el) =>
      el.textContent?.includes('Hiện tab Logs'),
    )?.querySelector('input') as HTMLInputElement
    expect(showLogs.checked).toBe(false)
  })

  it('mounts backdrop + title «Cài đặt»', () => {
    mount(SettingsDialog, { attachTo: document.body })
    expect(document.querySelector('.modal-backdrop')).toBeTruthy()
    expect(document.body.textContent).toContain('Cài đặt')
  })

  it('click .modal-close emits close', async () => {
    const w = mount(SettingsDialog, { attachTo: document.body })
    const closeBtn = document.querySelector('.modal-close') as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    closeBtn.click()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Escape keydown emits close', async () => {
    const w = mount(SettingsDialog, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('unmount removes keydown listener', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const w = mount(SettingsDialog, { attachTo: document.body })
    w.unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })

  it('TC-SD-01: empty localStorage → Block radio checked', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const block = document.querySelector(
      'input[name="artifactViewMode"][value="block"]',
    ) as HTMLInputElement
    const full = document.querySelector(
      'input[name="artifactViewMode"][value="full"]',
    ) as HTMLInputElement
    expect(block.checked).toBe(true)
    expect(full.checked).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('TC-SD-02: chọn Full → persist artifactViewMode full', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const full = document.querySelector(
      'input[name="artifactViewMode"][value="full"]',
    ) as HTMLInputElement
    full.checked = true
    full.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      artifactViewMode: 'full',
    })
  })

  it('TC-SD-03: seed full → Full radio checked', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ artifactViewMode: 'full' }))
    const { load } = useAppSettings()
    load()
    mount(SettingsDialog, { attachTo: document.body })
    const full = document.querySelector(
      'input[name="artifactViewMode"][value="full"]',
    ) as HTMLInputElement
    const block = document.querySelector(
      'input[name="artifactViewMode"][value="block"]',
    ) as HTMLInputElement
    expect(full.checked).toBe(true)
    expect(block.checked).toBe(false)
  })

  it('TC-SD-04 / TC-U-03: Esc vẫn emit close', async () => {
    const w = mount(SettingsDialog, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('TC-TH-01: empty localStorage → Hệ thống radio checked', () => {
    mount(SettingsDialog, { attachTo: document.body })
    const system = document.querySelector(
      'input[name="theme"][value="system"]',
    ) as HTMLInputElement
    expect(system.checked).toBe(true)
  })

  it('TC-TH-02: chọn Sáng → persist theme light + data-theme', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const light = document.querySelector(
      'input[name="theme"][value="light"]',
    ) as HTMLInputElement
    light.checked = true
    light.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('TC-TH-03: seed dark → Tối radio checked', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'dark' }))
    const { load } = useAppSettings()
    load()
    mount(SettingsDialog, { attachTo: document.body })
    const dark = document.querySelector(
      'input[name="theme"][value="dark"]',
    ) as HTMLInputElement
    expect(dark.checked).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('sidebar section: toggling checkboxes persists collapse-on-outside prefs', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    expect(document.body.textContent).toContain('Sidebar')

    const labels = Array.from(document.querySelectorAll('.settings-checkbox'))
    const appLabel = labels.find((el) =>
      el.textContent?.includes('Tự thu gọn sidebar chính'),
    ) as HTMLElement
    const monitorLabel = labels.find((el) =>
      el.textContent?.includes('Tự thu gọn sub-sidebar Monitor'),
    ) as HTMLElement
    expect(appLabel).toBeTruthy()
    expect(monitorLabel).toBeTruthy()

    const appCb = appLabel.querySelector('input') as HTMLInputElement
    const monitorCb = monitorLabel.querySelector('input') as HTMLInputElement
    expect(appCb.checked).toBe(false)
    expect(monitorCb.checked).toBe(false)

    appCb.checked = true
    appCb.dispatchEvent(new Event('change', { bubbles: true }))
    monitorCb.checked = true
    monitorCb.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.collapseAppSidebarOnOutside).toBe(true)
    expect(stored.collapseMonitorSubSidebarOnOutside).toBe(true)
  })

  it('shows Projects autoscan section and toggles info tip on click', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const projectsNav = document.querySelector(
      '.settings-nav-item[data-group="projects"]',
    ) as HTMLButtonElement
    expect(projectsNav).toBeTruthy()
    projectsNav.click()
    await flushPromises()

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(pane.textContent).toContain('Autoscan')
    expect(pane.textContent).toContain('Whitelist')
    expect(pane.textContent).toContain('Token GitHub')
    expect(pane.textContent).toContain('acme/app')

    const editBtn = Array.from(document.querySelectorAll('.settings-github-tokens .icon-btn')).find(
      (el) => (el as HTMLElement).getAttribute('aria-label') === 'Sửa',
    ) as HTMLButtonElement
    expect(editBtn).toBeTruthy()
    editBtn.click()
    await flushPromises()
    expect((document.querySelector('.settings-github-tokens-add input') as HTMLInputElement).value).toBe(
      'acme/app',
    )
    expect(pane.textContent).toContain('Cập nhật')
    expect(pane.textContent).toContain('Huỷ')

    const info = document.querySelector('.settings-info-btn') as HTMLButtonElement
    expect(info).toBeTruthy()
    expect(document.querySelector('.settings-info-tip')).toBeNull()

    info.click()
    await flushPromises()
    const tip = document.querySelector('.settings-info-tip') as HTMLElement
    expect(tip).toBeTruthy()
    expect(tip.textContent).toContain('60')
  })

  it('notifications position: dropdown defaults to both; change persists', async () => {
    mount(SettingsDialog, { attachTo: document.body })
    const notifNav = document.querySelector(
      '.settings-nav-item[data-group="notifications"]',
    ) as HTMLButtonElement
    expect(notifNav).toBeTruthy()
    notifNav.click()
    await flushPromises()

    const pane = document.querySelector('.settings-pane.modal-body') as HTMLElement
    expect(pane.textContent).toContain('Vị trí hiển thị')

    const trigger = document.querySelector('.c-select-trigger') as HTMLButtonElement
    expect(trigger).toBeTruthy()
    expect(trigger.textContent).toContain('Cả sidebar và icon nổi')

    trigger.click()
    await flushPromises()
    const options = Array.from(document.querySelectorAll('.c-select-option')) as HTMLElement[]
    expect(options).toHaveLength(3)
    const floating = options.find((el) => el.textContent?.includes('Chỉ icon nổi'))
    expect(floating).toBeTruthy()
    floating!.click()
    await Promise.resolve()

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      notificationUiPlacement: 'floating',
    })
  })
})

describe('SettingsDialog — scan patterns', () => {
  const openProjects = async () => {
    mount(SettingsDialog, { attachTo: document.body })
    ;(document.querySelector('.settings-nav-item[data-group="projects"]') as HTMLButtonElement).click()
    await flushPromises()
    return document.querySelector('.settings-pane.modal-body') as HTMLElement
  }

  const kindBlock = (kind: string) =>
    document.querySelector(`.settings-scan-patterns .settings-subsection[data-kind="${kind}"]`) as HTMLElement

  const addPattern = async (kind: string, value: string) => {
    const block = kindBlock(kind)
    const input = block.querySelector('input') as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    ;(block.querySelector('.settings-whitelist-add button') as HTMLButtonElement).click()
    await flushPromises()
  }

  it('renders one list per kind inside the Projects group', async () => {
    const pane = await openProjects()
    expect(pane.textContent).toContain('Pattern scan agents / skills / rules')
    for (const kind of ['agents', 'skills', 'rules']) {
      expect(kindBlock(kind)).toBeTruthy()
    }
  })

  it('empty state names the defaults still in use', async () => {
    await openProjects()
    const empty = kindBlock('rules').querySelector('.settings-whitelist-empty') as HTMLElement
    expect(empty.textContent).toContain('Chưa có pattern')
    expect(empty.textContent).toContain('docs/agent-rules/')
  })

  it('adding a valid pattern persists it for that kind only', async () => {
    await openProjects()
    await addPattern('agents', './.agents/*.md')
    expect(vi.mocked(saveScanPatternsConfig)).toHaveBeenCalledWith({
      agents: ['.agents/*.md'],
      skills: [],
      rules: [],
    })
    expect(kindBlock('agents').textContent).toContain('.agents/*.md')
  })

  it('rejects an unsafe pattern in place without calling the API', async () => {
    const pane = await openProjects()
    await addPattern('rules', '../outside')
    expect(vi.mocked(saveScanPatternsConfig)).not.toHaveBeenCalled()
    expect(pane.textContent).toContain('Pattern không hợp lệ')
  })

  it('removing a pattern persists the shorter list', async () => {
    await openProjects()
    await addPattern('skills', 'packages/*/skills')
    vi.mocked(saveScanPatternsConfig).mockClear()
    const removeBtn = kindBlock('skills').querySelector(
      '.settings-whitelist-item .icon-btn',
    ) as HTMLButtonElement
    removeBtn.click()
    await flushPromises()
    expect(vi.mocked(saveScanPatternsConfig)).toHaveBeenCalledWith({
      agents: [],
      skills: [],
      rules: [],
    })
  })

  it('keeps several patterns of one kind in insertion order', async () => {
    await openProjects()
    await addPattern('rules', 'docs/rules')
    await addPattern('rules', 'guides')
    const shown = Array.from(
      kindBlock('rules').querySelectorAll('.settings-whitelist-path'),
    ).map((el) => el.textContent)
    expect(shown).toEqual(['docs/rules', 'guides'])
  })

  it('surfaces a failed save to the user', async () => {
    vi.mocked(saveScanPatternsConfig).mockRejectedValueOnce(new Error('boom'))
    const pane = await openProjects()
    await addPattern('agents', '.agents')
    expect(pane.textContent).toContain('boom')
  })
})
