import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import SettingsDialog from '@/features/settings/components/SettingsDialog.vue'
import {
  STORAGE_KEY,
  useAppSettings,
} from '@/shared/composables/useAppSettings'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    fetchAutoscanConfig: vi.fn(async () => ({
      config: { enabled: false, whitelist: [], intervalMs: 60_000 },
    })),
    saveAutoscanConfig: vi.fn(async (c: object) => ({ config: c })),
    runAutoscan: vi.fn(async () => ({
      report: { added: [], existing: [], skipped: [], errors: [], hits: [], scanned: 0 },
    })),
  }
})

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
    expect(text).not.toContain('Autoscan')
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

    const info = document.querySelector('.settings-info-btn') as HTMLButtonElement
    expect(info).toBeTruthy()
    expect(document.querySelector('.settings-info-tip')).toBeNull()

    info.click()
    await flushPromises()
    const tip = document.querySelector('.settings-info-tip') as HTMLElement
    expect(tip).toBeTruthy()
    expect(tip.textContent).toContain('60')
  })
})
