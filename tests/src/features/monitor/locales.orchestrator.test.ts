import { describe, expect, it } from 'vitest'
import { createTestI18n } from '../../helpers/i18n'

// TC-38: mọi nhãn mới phải có bản dịch ở **cả** locale repo hỗ trợ. Test chỉ
// kiểm "không thiếu khoá", không kiểm từ ngữ — `design.md` §6 ghi nhận chuỗi
// "orchestrator" trong repo đang mang hai nghĩa và cố ý không đổi ở task này.

const KEYS = [
  'monitor.pipeline.orchestrator',
  'monitor.pipeline.orchestratorHalted',
  // Nhãn mới của task T05fde6f6 — nút Run trên node điều phối (TC-38).
  'monitor.pipeline.orchestratorStarted',
  'monitor.pipelineNode.clickToStartOrchestrator',
  'monitor.pipelineNode.startOrchestrator',
  'monitor.pipelineNode.clickToStopOrchestrator',
  'monitor.pipelineNode.stopOrchestrator',
  'monitor.pipelineNode.orchestrated',
  'monitor.pipelineNode.orchestratorState.listening',
  'monitor.pipelineNode.orchestratorState.dispatching',
  'monitor.pipelineNode.orchestratorState.halted',
  'pipelineEditor.orchestrator.checkbox',
  'pipelineEditor.orchestrator.checkboxTitle',
  'pipelineEditor.orchestrator.nodeLabel',
  'pipelineEditor.orchestrator.nodeTitle',
  'pipelineEditor.orchestrator.noAgent',
]

describe.each(['vi', 'en'] as const)('i18n nhãn orchestrator — locale %s', (locale) => {
  const t = (key: string) => (createTestI18n(locale).global as any).t(key)

  it.each(KEYS)('%s có bản dịch', (key) => {
    const value = t(key)
    // vue-i18n trả lại chính khoá khi thiếu bản dịch — đó là lỗi cần bắt.
    expect(value).not.toBe(key)
    expect(String(value).trim().length).toBeGreaterThan(0)
  })
})
