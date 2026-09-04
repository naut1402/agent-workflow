import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Icon from '@/core/ui/Icon.vue'

describe('Icon', () => {
  it('renders the fill/stroke icon with its own viewBox (24x24)', () => {
    const wrapper = mount(Icon, { props: { name: 'chatBubble' } })
    const svg = wrapper.find('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 24 24')
    expect(svg.findAll('path')).toHaveLength(2)
  })

  it('renders a 16x16 stroke icon with its own viewBox', () => {
    const wrapper = mount(Icon, { props: { name: 'close' } })
    const svg = wrapper.find('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 16 16')
    expect(svg.find('path').attributes('d')).toBe('M4 4l8 8M12 4l-8 8')
  })

  it('does not set fill/stroke defaults on the root svg', () => {
    const wrapper = mount(Icon, { props: { name: 'trash' } })
    const svg = wrapper.find('svg')
    expect(svg.attributes('fill')).toBeUndefined()
    expect(svg.attributes('stroke')).toBeUndefined()
  })

  it('size prop controls width/height, default is 16', () => {
    const defaultSize = mount(Icon, { props: { name: 'plus' } })
    expect(defaultSize.find('svg').attributes('width')).toBe('16')
    expect(defaultSize.find('svg').attributes('height')).toBe('16')

    const customSize = mount(Icon, { props: { name: 'plus', size: 24 } })
    expect(customSize.find('svg').attributes('width')).toBe('24')
    expect(customSize.find('svg').attributes('height')).toBe('24')
  })

  it('forwards fallthrough class/attrs to the root svg', () => {
    const wrapper = mount(Icon, { props: { name: 'bell' }, attrs: { class: 'bell-icon' } })
    expect(wrapper.find('svg').classes()).toContain('bell-icon')
  })
})
