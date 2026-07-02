import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SectionSaveIndicator from '@/features/monitor/components/SectionSaveIndicator.vue'

describe('SectionSaveIndicator', () => {
  it('renders nothing when idle', () => {
    const w = mount(SectionSaveIndicator)
    expect(w.find('.md-save-indicator').exists()).toBe(false)
  })

  it('renders saving dots while persisting', () => {
    const w = mount(SectionSaveIndicator, { props: { saving: true } })
    expect(w.find('.md-save-indicator.saving').text()).toBe('⋯')
  })

  it('renders check icon after save', () => {
    const w = mount(SectionSaveIndicator, { props: { saved: true } })
    expect(w.find('.md-save-indicator.saved').exists()).toBe(true)
    expect(w.find('.md-save-indicator.saved svg').exists()).toBe(true)
  })
})
