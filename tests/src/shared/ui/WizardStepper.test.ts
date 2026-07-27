import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WizardStepper from '@/shared/ui/WizardStepper.vue'

const steps = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta' },
  { key: 'c', label: 'Gamma' },
  { key: 'd', label: 'Delta' },
]

function mountStepper(props: Record<string, unknown> = {}) {
  return mount(WizardStepper, { props: { steps, current: 1, ...props } })
}

describe('WizardStepper', () => {
  it('renders every step label with its 1-based number', () => {
    const w = mountStepper()
    const items = w.findAll('.wizard-stepper-item')
    expect(items).toHaveLength(4)
    expect(items[0].text()).toContain('Alpha')
    expect(items[3].text()).toContain('Delta')
    expect(items[3].find('.wizard-stepper-dot').text()).toBe('4')
  })

  it('marks only the current step with aria-current and the current class', () => {
    const w = mountStepper({ current: 2 })
    const items = w.findAll('.wizard-stepper-item')
    expect(items[1].attributes('aria-current')).toBe('step')
    expect(items[1].classes()).toContain('is-current')
    expect(items[0].attributes('aria-current')).toBeUndefined()
    expect(items[0].classes()).toContain('is-done')
    expect(items[2].classes()).toContain('is-ahead')
  })

  it('locks forward steps beyond maxReachable but keeps earlier steps clickable', () => {
    const w = mountStepper({ current: 2, maxReachable: 2 })
    const btns = w.findAll('.wizard-stepper-btn')
    expect(btns[0].attributes('disabled')).toBeUndefined() // backward — always open
    expect(btns[1].attributes('disabled')).toBeDefined() // current — not navigable
    expect(btns[2].attributes('disabled')).toBeDefined() // ahead of the gate
    expect(btns[3].attributes('disabled')).toBeDefined()
  })

  it('opens every step once maxReachable covers them', () => {
    const w = mountStepper({ current: 1, maxReachable: 4 })
    const btns = w.findAll('.wizard-stepper-btn')
    expect(btns[1].attributes('disabled')).toBeUndefined()
    expect(btns[3].attributes('disabled')).toBeUndefined()
  })

  it('emits go with the 1-based step index', async () => {
    const w = mountStepper({ current: 1, maxReachable: 4 })
    await w.findAll('.wizard-stepper-btn')[3].trigger('click')
    expect(w.emitted('go')).toEqual([[4]])
  })

  it('does not emit for a locked step', async () => {
    const w = mountStepper({ current: 1, maxReachable: 1 })
    await w.findAll('.wizard-stepper-btn')[2].trigger('click')
    expect(w.emitted('go')).toBeUndefined()
  })

  it('locks all steps when disabled', async () => {
    const w = mountStepper({ current: 3, maxReachable: 4, disabled: true })
    const btns = w.findAll('.wizard-stepper-btn')
    expect(btns.every((b) => b.attributes('disabled') !== undefined)).toBe(true)
    await btns[0].trigger('click')
    expect(w.emitted('go')).toBeUndefined()
  })
})
