import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it, vi } from 'vitest'
import PipelineNode from '@/features/monitor/components/PipelineNode.vue'

// AC-3: node điều phối **chat được**, **stop được**, và **KHÔNG restart được**.
// Chấm theo tập control render ra — đúng bề mặt mà test-spec chỉ định cho TC-24.

function mountOrchestrator(data: Record<string, any> = {}) {
  return mount(PipelineNode, {
    props: {
      data: {
        kind: 'orchestrator',
        label: 'Điều phối',
        taskId: 'T1',
        stepId: '__orchestrator__',
        executed: true,
        orchestratorState: 'listening',
        ...data,
      },
    },
    global: { stubs: { Handle: true } },
  })
}

describe('biến thể orchestrator — tập control (TC-24)', () => {
  it('KHÔNG có nút Run ở mọi trạng thái', () => {
    for (const state of ['listening', 'dispatching', 'halted']) {
      for (const runnable of [true, false]) {
        const w = mountOrchestrator({ orchestratorState: state, runnable })
        expect(w.find('.pnode-run-btn').exists()).toBe(false)
      }
    }
  })

  it('KHÔNG có nút Reset ở mọi trạng thái', () => {
    for (const state of ['listening', 'dispatching', 'halted']) {
      for (const resettable of [true, false]) {
        const w = mountOrchestrator({ orchestratorState: state, resettable })
        expect(w.find('.pnode-reset-btn').exists()).toBe(false)
      }
    }
  })

  it('có nút chat', () => {
    expect(mountOrchestrator().find('.pnode-chat-btn').exists()).toBe(true)
  })
})

describe('nút Stop luôn sẵn sàng khi đang điều phối (TC-23, TC-25)', () => {
  // Phần lớn thời gian orchestrator dispatch tất định, không có job nào của nó
  // chạy. Gắn Stop vào "đang chạy job" thì đúng lúc task đứng — lúc cần Stop
  // nhất — node lại không có nút nào, mà Run/Reset trên step cũng đã ẩn.
  it('hiện cả khi orchestrator đang rảnh (listening)', () => {
    const w = mountOrchestrator({ orchestratorState: 'listening', running: false })
    expect(w.find('.pnode-stop-btn').exists()).toBe(true)
  })

  it('hiện khi đang quyết định (dispatching)', () => {
    const w = mountOrchestrator({ orchestratorState: 'dispatching', running: true })
    expect(w.find('.pnode-stop-btn').exists()).toBe(true)
  })

  it('ẩn khi đã dừng — không stop hai lần', () => {
    const w = mountOrchestrator({ orchestratorState: 'halted' })
    expect(w.find('.pnode-stop-btn').exists()).toBe(false)
  })

  it('bấm Stop gọi đúng handler', async () => {
    const onStop = vi.fn()
    const w = mountOrchestrator({ onStop })
    await w.find('.pnode-stop-btn').trigger('click')
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})

describe('hiển thị trạng thái', () => {
  it('nhãn trạng thái có bản dịch, không lộ khoá thô', () => {
    for (const state of ['listening', 'dispatching', 'halted']) {
      const sub = mountOrchestrator({ orchestratorState: state }).find('.pnode-sub').text()
      expect(sub).not.toContain('monitor.pipelineNode')
      expect(sub.length).toBeGreaterThan(0)
    }
  })

  it('node mang class riêng để phân biệt với node step', () => {
    expect(mountOrchestrator().find('.pnode').classes()).toContain('pnode-orchestrator')
  })

  it('không dùng affordance click-để-chạy của node step', () => {
    const classes = mountOrchestrator({ runnable: true, status: 'active' }).find('.pnode').classes()
    expect(classes).not.toContain('pnode-runnable')
  })
})

describe('node step khi đang bị điều phối', () => {
  function mountStep(data: Record<string, any>) {
    return mount(PipelineNode, {
      props: { data: { label: 'Implement', status: 'active', taskId: 'T1', stepId: 'implementer', ...data } },
      global: { stubs: { Handle: true } },
    })
  }

  it('hiện nhãn phụ nói rõ vì sao Run/Reset biến mất', () => {
    const w = mountStep({ orchestrated: true, runnable: false, resettable: false })
    expect(w.find('.pnode-orchestrated').exists()).toBe(true)
    expect(w.find('.pnode-orchestrated').text()).not.toContain('monitor.pipelineNode')
  })

  it('không bị điều phối ⇒ không có nhãn phụ, Run vẫn như cũ (TC-12)', () => {
    const w = mountStep({ orchestrated: false, runnable: true })
    expect(w.find('.pnode-orchestrated').exists()).toBe(false)
    expect(w.find('.pnode-run-btn').exists()).toBe(true)
  })

  // TC-27 — chat với step vẫn hoạt động khi orchestrator bật.
  it('vẫn chat được với step khi đang bị điều phối', () => {
    const w = mountStep({ orchestrated: true, executed: true, runnable: false })
    expect(w.find('.pnode-chat-btn').exists()).toBe(true)
  })
})
