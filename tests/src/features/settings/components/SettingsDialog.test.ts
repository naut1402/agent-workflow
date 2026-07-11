import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SettingsDialog from '@/features/settings/components/SettingsDialog.vue'
import {
  STORAGE_KEY,
  useAppSettings,
} from '@/shared/composables/useAppSettings'

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

  it('TC-SD-04: Esc vẫn emit close', async () => {
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
})
