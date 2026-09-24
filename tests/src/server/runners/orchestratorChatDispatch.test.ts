import { describe, expect, test } from 'bun:test'
import { parseOrchestratorDecision } from '../../../../src/features/runner/business/jobQueue.js'

/*
 * Td2be3c3e TC10 — regression guard: kênh chat trực tiếp với một step riêng lẻ
 * (bridge "chat → dispatch step" ở `tryDispatchOrchestratorDecision`) chỉ hỗ
 * trợ `start`/`resume` (design.md §6, comment sẵn có `SUPPORTED_ORCHESTRATOR_ACTIONS`
 * ở jobQueue.ts:44) — `respawn` cố ý KHÔNG được mở rộng vào đây, nó chỉ đi qua
 * `applyDecision`/`ACTION_HANDLERS` (API `POST /api/orchestrator/decide` hoặc
 * sentinel line của chính job orchestrator, xem decisionLoop.ts).
 */

describe('parseOrchestratorDecision — chỉ nhận start/resume (Td2be3c3e TC10)', () => {
  test('start được nhận diện', () => {
    expect(parseOrchestratorDecision('ORCHESTRATOR_DECISION: {"action":"start","stepId":"implementer"}')).toEqual({
      action: 'start',
      stepId: 'implementer',
    })
  })

  test('resume được nhận diện', () => {
    expect(parseOrchestratorDecision('ORCHESTRATOR_DECISION: {"action":"resume","stepId":"implementer"}')).toEqual({
      action: 'resume',
      stepId: 'implementer',
    })
  })

  test('respawn KHÔNG được nhận diện qua kênh này — trả null, không áp dụng gì', () => {
    expect(
      parseOrchestratorDecision('ORCHESTRATOR_DECISION: {"action":"respawn","stepId":"implementer"}'),
    ).toBeNull()
  })

  test('respawn lẫn giữa nhiều dòng — vẫn không được nhận diện dù là dòng cuối', () => {
    const stdout = [
      'Tôi nghĩ nên chạy lại implementer.',
      'ORCHESTRATOR_DECISION: {"action":"respawn","stepId":"implementer","context":"revert filter"}',
    ].join('\n')
    expect(parseOrchestratorDecision(stdout)).toBeNull()
  })
})
