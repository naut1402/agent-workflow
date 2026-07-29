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

  // Corner actions: always rendered (a hover-only popover outside the node was
  // unreachable — the cursor left the node before arriving at the button).
  describe('corner actions', () => {
    it('chat button shows without hovering, whenever the node knows its task', () => {
      const w = mountNode({ label: 'Design', status: 'done', taskId: 'DEMO-1', stepId: 'design' })
      expect(w.find('.pnode-chat-btn').exists()).toBe(true)
    })

    it('no chat button when the node has no task context', () => {
      expect(mountNode({ label: 'Design', status: 'done' }).find('.pnode-chat-btn').exists()).toBe(false)
    })

    it('run button appears under exactly the same condition as click-to-run', () => {
      expect(mountNode({ label: 'Implement', status: 'active', runnable: true }).find('.pnode-run-btn').exists()).toBe(true)
      expect(mountNode({ label: 'Implement', status: 'active', runnable: false }).find('.pnode-run-btn').exists()).toBe(false)
      expect(mountNode({ label: 'Investigate', status: 'waiting', hitl: 'h1' }).find('.pnode-run-btn').exists()).toBe(false)
      expect(mountNode({ label: 'Investigate', status: 'done' }).find('.pnode-run-btn').exists()).toBe(false)
    })

    it('run sits before chat in the same row', () => {
      const w = mountNode({ label: 'Implement', status: 'active', runnable: true, taskId: 'DEMO-1' })
      const classes = w.findAll('.pnode-actions .pnode-action').map((b) => b.classes().join(' '))
      expect(classes[0]).toContain('pnode-run-btn')
      expect(classes[1]).toContain('pnode-chat-btn')
    })

    it('run button calls data.onRun (same confirm dialog as clicking the node)', async () => {
      const calls: number[] = []
      const w = mountNode({
        label: 'Implement',
        status: 'active',
        runnable: true,
        onRun: () => calls.push(1),
      })
      await w.find('.pnode-run-btn').trigger('click')
      expect(calls).toHaveLength(1)
    })
  })

  it('running=true shows the running class/icon and overrides the runnable affordance', () => {
    const w = mountNode({ label: 'Implement', status: 'active', running: true, runnable: false })
    expect(w.find('.pnode').classes()).toContain('pnode-running')
    expect(w.find('.pnode').classes()).not.toContain('pnode-runnable')
    expect(w.find('.pnode-bubble').text()).toBe('⏳')
    expect(w.find('.pnode-bubble').attributes('title')).toBe('Đang chạy…')
  })
})
