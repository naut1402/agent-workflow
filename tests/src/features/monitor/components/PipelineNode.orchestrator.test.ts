import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it, vi } from 'vitest'
import PipelineNode from '@/features/monitor/components/PipelineNode.vue'

// TC-03 của test-spec: node điều phối phải có **ít nhất một đường thoát khả dụng**
// ở MỌI trạng thái. Triệu chứng ① của đề bài là đúng cảnh ngược lại — "UI chỉ
// hiển thị một nút dừng; bấm nút dừng thì hoàn toàn không thể start lại".
// Chấm theo tập control render ra, đúng bề mặt mà test-spec chỉ định.

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

/** Tập control hành động đang hiện trên node. */
function controls(w: ReturnType<typeof mountOrchestrator>): string[] {
  return ['pnode-run-btn', 'pnode-stop-btn', 'pnode-reset-btn', 'pnode-chat-btn'].filter((c) =>
    w.find(`.${c}`).exists(),
  )
}

describe('TC-03 — mọi trạng thái đều có đường thoát', () => {
  // Đây là cổng chặn regression của bug gốc: 🚫 không tồn tại trạng thái nào mà
  // tập control còn lại chỉ là nút dừng, hoặc rỗng.
  it('không trạng thái nào chỉ còn mỗi nút dừng, cũng không trạng thái nào trắng nút', () => {
    for (const state of ['listening', 'dispatching', 'halted']) {
      for (const busy of [true, false]) {
        const set = controls(mountOrchestrator({ orchestratorState: state, orchestratorBusy: busy }))
        expect(set.length).toBeGreaterThan(0)
        expect(set).not.toEqual(['pnode-stop-btn'])
      }
    }
  })

  it('rảnh ⇒ có nút Run (kể cả khi đang ở trạng thái đã dừng)', () => {
    for (const state of ['listening', 'dispatching', 'halted']) {
      const w = mountOrchestrator({ orchestratorState: state, orchestratorBusy: false })
      expect(w.find('.pnode-run-btn').exists()).toBe(true)
      expect(w.find('.pnode-stop-btn').exists()).toBe(false)
    }
  })

  // TC-25 vế (b): sau khi reset bằng checkbox, node trở lại trạng thái có Run.
  it('đã dừng ⇒ vẫn có đường chạy lại', () => {
    expect(controls(mountOrchestrator({ orchestratorState: 'halted' }))).toContain('pnode-run-btn')
  })

  it('đang bận ⇒ đổi sang nút Stop, không hiện Run cùng lúc', () => {
    const w = mountOrchestrator({ orchestratorState: 'dispatching', orchestratorBusy: true })
    expect(w.find('.pnode-stop-btn').exists()).toBe(true)
    expect(w.find('.pnode-run-btn').exists()).toBe(false)
  })

  // Node điều phối không phải một step: trạng thái của nó chỉ là cờ dừng, không
  // có artifact để xoá, nên Reset không có nghĩa ở đây.
  it('KHÔNG có nút Reset ở mọi trạng thái', () => {
    for (const state of ['listening', 'dispatching', 'halted']) {
      for (const resettable of [true, false]) {
        const w = mountOrchestrator({ orchestratorState: state, resettable })
        expect(w.find('.pnode-reset-btn').exists()).toBe(false)
      }
    }
  })

  it('luôn chat được với node', () => {
    for (const state of ['listening', 'dispatching', 'halted']) {
      for (const busy of [true, false]) {
        expect(
          mountOrchestrator({ orchestratorState: state, orchestratorBusy: busy }).find('.pnode-chat-btn').exists(),
        ).toBe(true)
      }
    }
  })
})

describe('TC-01/TC-04 — hai nút gọi đúng hai đường', () => {
  it('bấm Run gọi handler start', async () => {
    const onRun = vi.fn()
    const w = mountOrchestrator({ orchestratorBusy: false, onRun })
    await w.find('.pnode-run-btn').trigger('click')
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('bấm Stop gọi handler stop', async () => {
    const onStop = vi.fn()
    const w = mountOrchestrator({ orchestratorBusy: true, onStop })
    await w.find('.pnode-stop-btn').trigger('click')
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  // TC-38 — nhãn/nút mới phải đi qua i18n, không lộ khoá thô ra UI.
  it('hai nút có nhãn trợ năng đã dịch, không lộ khoá thô', () => {
    for (const [busy, cls] of [
      [false, '.pnode-run-btn'],
      [true, '.pnode-stop-btn'],
    ] as const) {
      const btn = mountOrchestrator({ orchestratorBusy: busy }).find(cls)
      for (const attr of ['aria-label', 'title']) {
        const text = btn.attributes(attr) ?? ''
        expect(text.length).toBeGreaterThan(0)
        expect(text).not.toContain('monitor.pipelineNode')
      }
    }
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

  // TC-31/TC-33 — pipeline không bật điều phối chạy y như trước.
  it('không bị điều phối ⇒ không có nhãn phụ, Run vẫn như cũ', () => {
    const w = mountStep({ orchestrated: false, runnable: true })
    expect(w.find('.pnode-orchestrated').exists()).toBe(false)
    expect(w.find('.pnode-run-btn').exists()).toBe(true)
  })

  // TC-17 — chat với step vẫn hoạt động khi orchestrator bật.
  it('vẫn chat được với step khi đang bị điều phối', () => {
    const w = mountStep({ orchestrated: true, executed: true, runnable: false })
    expect(w.find('.pnode-chat-btn').exists()).toBe(true)
  })

  // Cờ `orchestratorBusy` là của node điều phối; nó không được đổi hành vi nút
  // trên node step.
  it('cờ bận của node điều phối không rò sang node step', () => {
    const w = mountStep({ orchestratorBusy: true, runnable: true, running: false })
    expect(w.find('.pnode-run-btn').exists()).toBe(true)
    expect(w.find('.pnode-stop-btn').exists()).toBe(false)
  })
})
