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

  // Node actions: always rendered (a hover-only popover outside the node was
  // unreachable — the cursor left the node before arriving at the button).
  describe('node actions', () => {
    it('chat shows only for a step that already ran (data.executed)', () => {
      const ran = mountNode({ label: 'Design', status: 'done', taskId: 'DEMO-1', stepId: 'design', executed: true })
      expect(ran.find('.pnode-chat-btn').exists()).toBe(true)
    })

    it('no chat for a step that never ran — there is no session history to show', () => {
      for (const data of [
        { status: 'pending', executed: false },
        { status: 'active', runnable: true, executed: false },
      ]) {
        const w = mountNode({ label: 'Review', taskId: 'DEMO-1', stepId: 'review', ...data })
        expect(w.find('.pnode-chat-btn').exists()).toBe(false)
      }
    })

    it('no chat button when the node has no task context', () => {
      expect(mountNode({ label: 'Design', status: 'done', executed: true }).find('.pnode-chat-btn').exists()).toBe(
        false,
      )
    })

    it('run button appears under exactly the same condition as click-to-run', () => {
      expect(mountNode({ label: 'Implement', status: 'active', runnable: true }).find('.pnode-run-btn').exists()).toBe(true)
      expect(mountNode({ label: 'Implement', status: 'active', runnable: false }).find('.pnode-run-btn').exists()).toBe(false)
      expect(mountNode({ label: 'Investigate', status: 'waiting', hitl: 'h1' }).find('.pnode-run-btn').exists()).toBe(false)
      expect(mountNode({ label: 'Investigate', status: 'done' }).find('.pnode-run-btn').exists()).toBe(false)
    })

    it('run is centred on the node, chat pinned right — both on the top border', () => {
      const w = mountNode({
        label: 'Design',
        status: 'active',
        runnable: true,
        executed: true,
        taskId: 'DEMO-1',
      })
      expect(w.find('.pnode-run-btn').classes()).toContain('pnode-action-center')
      expect(w.find('.pnode-chat-btn').classes()).toContain('pnode-action-right')
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
