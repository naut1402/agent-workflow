import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it } from 'vitest'
import PipelineNode from '@/features/monitor/components/PipelineNode.vue'

// `Handle` (@vue-flow/core) reads its VueFlow provide/inject context — mounting
// PipelineNode standalone (outside a real <VueFlow>) needs it stubbed out.
function mountNode(data: Record<string, any>) {
  return mount(PipelineNode, { props: { data }, global: { stubs: { Handle: true } } })
}

describe('PipelineNode', () => {
  it('runnable=true is clickable and shows the run tooltip', () => {
    const w = mountNode({ label: 'Implement', status: 'active', runnable: true })
    expect(w.find('.pnode').classes()).toContain('pnode-runnable')
    expect(w.find('.pnode-bubble').attributes('title')).toBe('Nhấn để chạy step này')
  })

  it('pending + runnable shows the run affordance', () => {
    const w = mountNode({ label: 'Review', status: 'pending', runnable: true })
    expect(w.find('.pnode').classes()).toContain('pnode-runnable')
  })

  it('active without runnable has no run affordance (e.g. broken state / in-flight)', () => {
    const w = mountNode({ label: 'Implement', status: 'active', runnable: false })
    expect(w.find('.pnode').classes()).not.toContain('pnode-runnable')
    expect(w.find('.pnode-bubble').attributes('title')).toBeUndefined()
  })

  it('waiting status keeps the existing approve affordance, not the run one', () => {
    const w = mountNode({ label: 'Investigate', status: 'waiting', hitl: 'hitl-1' })
    expect(w.find('.pnode').classes()).toContain('pnode-waiting')
    expect(w.find('.pnode').classes()).not.toContain('pnode-runnable')
    expect(w.find('.pnode-bubble').attributes('title')).toBe('Nhấn để duyệt')
  })

  it('done status has no click affordance', () => {
    const w = mountNode({ label: 'Investigate', status: 'done' })
    expect(w.find('.pnode').classes()).not.toContain('pnode-runnable')
    expect(w.find('.pnode').classes()).not.toContain('pnode-waiting')
    expect(w.find('.pnode-bubble').attributes('title')).toBeUndefined()
  })

  it('running=true shows the running class/icon and overrides the runnable affordance', () => {
    const w = mountNode({ label: 'Implement', status: 'active', running: true, runnable: false })
    expect(w.find('.pnode').classes()).toContain('pnode-running')
    expect(w.find('.pnode').classes()).not.toContain('pnode-runnable')
    expect(w.find('.pnode-bubble').text()).toBe('⏳')
    expect(w.find('.pnode-bubble').attributes('title')).toBe('Đang chạy…')
  })
})
