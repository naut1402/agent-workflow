import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_STEP_ID } from '@/shared/lib/orchestrator'
import {
  ORCHESTRATOR_NODE_ID,
  ORCHESTRATOR_Y_OFFSET,
  isOrchestratorNode,
  orchestratorPositionOf,
} from '@/frontend/lib/orchestratorNode'
import { KNOWLEDGE_Y_OFFSET, NODE_Y } from '@/frontend/lib/pipelineArtifactGraph'

// AC-2b: node render "phía trên, chính giữa các node". Hai canvas (editor và
// monitor) dùng chung đúng phép tính này — lệch nhau thì node nhảy chỗ khi
// chuyển màn, nên nó có suite riêng thay vì kiểm gián tiếp qua từng canvas.

describe('định danh node', () => {
  it('id node canvas = id step của orchestrator (một nguồn, không nhân đôi hằng)', () => {
    expect(ORCHESTRATOR_NODE_ID).toBe(ORCHESTRATOR_STEP_ID)
  })

  it('id mang tiền tố __ nên không đụng id step người dùng đặt', () => {
    expect(ORCHESTRATOR_NODE_ID.startsWith('__')).toBe(true)
  })

  it('isOrchestratorNode nhận đúng node, bỏ qua node khác và giá trị rỗng', () => {
    expect(isOrchestratorNode({ id: ORCHESTRATOR_NODE_ID })).toBe(true)
    expect(isOrchestratorNode({ id: 'implementer' })).toBe(false)
    expect(isOrchestratorNode(null)).toBe(false)
    expect(isOrchestratorNode(undefined)).toBe(false)
  })
})

describe('orchestratorPositionOf — trên cùng, căn giữa (TC-05)', () => {
  it('tâm ngang trùng trung điểm dải step', () => {
    const pos = orchestratorPositionOf({ a: { x: 0, y: NODE_Y }, b: { x: 400, y: NODE_Y } })
    expect(pos.x).toBe(200)
  })

  it('một step duy nhất ⇒ thẳng trên step đó', () => {
    expect(orchestratorPositionOf({ a: { x: 120, y: NODE_Y } }).x).toBe(120)
  })

  // TC-05 case (c): step đã bị kéo lệch — căn giữa phải tính theo vị trí THỰC TẾ.
  it('step bị kéo lệch ⇒ vẫn căn theo hộp bao thực tế, không theo vị trí mặc định', () => {
    const pos = orchestratorPositionOf({
      a: { x: -100, y: 10 },
      b: { x: 700, y: 260 },
      c: { x: 300, y: 90 },
    })
    expect(pos.x).toBe(300)
  })

  it('nằm phía TRÊN mọi step node', () => {
    const pos = orchestratorPositionOf({ a: { x: 0, y: NODE_Y }, b: { x: 400, y: NODE_Y } })
    expect(pos.y).toBeLessThan(NODE_Y)
  })

  // E17 — hai loại node phái sinh không được chồng nhau.
  it('nằm trên cả node knowledge', () => {
    expect(ORCHESTRATOR_Y_OFFSET).toBeLessThan(KNOWLEDGE_Y_OFFSET)
  })

  // TC-06: pipeline 0 step — toạ độ phải xác định, tuyệt đối không NaN.
  it('không có step nào ⇒ toạ độ xác định, không NaN', () => {
    for (const input of [{}, null, undefined]) {
      const pos = orchestratorPositionOf(input as any)
      expect(Number.isFinite(pos.x)).toBe(true)
      expect(Number.isFinite(pos.y)).toBe(true)
    }
  })
})
