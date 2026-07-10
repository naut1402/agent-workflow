import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SettingsDialog from '@/features/settings/components/SettingsDialog.vue'

afterEach(() => {
  document.body.innerHTML = ''
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
})
