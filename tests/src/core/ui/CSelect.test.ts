import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../helpers/i18n'
import CSelect from '@/core/ui/CSelect.vue'

const options = [
  { value: 'both', label: 'Both' },
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'floating', label: 'Floating' },
]

describe('CSelect', () => {
  it('shows the selected label on the trigger', () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'sidebar', options, ariaLabel: 'Placement' },
    })
    expect(wrapper.find('.c-select-value').text()).toBe('Sidebar')
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)
  })

  it('opens the custom menu and emits update on option click', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'both', options, ariaLabel: 'Placement' },
      attachTo: document.body,
    })

    await wrapper.find('.c-select-trigger').trigger('click')
    expect(wrapper.find('.c-select-menu').exists()).toBe(true)
    expect(wrapper.findAll('.c-select-option')).toHaveLength(3)

    await wrapper.findAll('.c-select-option')[2].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe('floating')
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)

    wrapper.unmount()
  })

  it('does not open when disabled', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'both', options, disabled: true },
    })
    await wrapper.find('.c-select-trigger').trigger('click')
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)
  })

  it('shows the placeholder when modelValue matches no option', () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: '', options, placeholder: 'Pick one' },
    })
    expect(wrapper.find('.c-select-value').text()).toBe('Pick one')
    expect(wrapper.find('.c-select-value').classes()).toContain('is-placeholder')
  })

  it('shows an empty-state row instead of a blank menu when there are no options', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: '', options: [] },
    })
    await wrapper.find('.c-select-trigger').trigger('click')
    expect(wrapper.find('.c-select-empty').exists()).toBe(true)
    expect(wrapper.findAll('.c-select-option')).toHaveLength(0)
  })

  it('opens and picks an option with the keyboard alone (no click)', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'both', options, ariaLabel: 'Placement' },
      attachTo: document.body,
    })

    await wrapper.find('.c-select-trigger').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.c-select-menu').exists()).toBe(true)

    await wrapper.find('.c-select-trigger').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('.c-select-trigger').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe('floating')
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)

    wrapper.unmount()
  })

  it('closes without picking on Escape', async () => {
    const wrapper = mountWithI18n(CSelect, {
      props: { modelValue: 'both', options, ariaLabel: 'Placement' },
      attachTo: document.body,
    })

    await wrapper.find('.c-select-trigger').trigger('click')
    await wrapper.find('.c-select-trigger').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.c-select-menu').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    wrapper.unmount()
  })
})
