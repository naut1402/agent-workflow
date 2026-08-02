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
})
