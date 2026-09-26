import { describe, expect, it } from 'vitest'
import { ResetStepRequest } from '@/features/monitor/schemas/resetStep'

// Td16ee130 — hợp đồng body của `POST /api/tasks/:id/reset-step`. Route test
// đã chấm mã trạng thái; ở đây chấm chính schema, nơi ràng buộc giữa hai trục
// phạm vi được chốt một lần cho mọi caller (`design.md` §4.2.1).

const valid = { stepId: 'implementer', resetScope: 'step', deleteScope: 'none' }

describe('ResetStepRequest', () => {
  it.each([
    ['step', 'none'],
    ['step', 'step'],
    ['onward', 'none'],
    ['onward', 'step'],
    ['onward', 'onward'],
  ])('chấp nhận tổ hợp hợp lệ resetScope=%s deleteScope=%s', (resetScope, deleteScope) => {
    expect(ResetStepRequest.safeParse({ ...valid, resetScope, deleteScope }).success).toBe(true)
  })

  it('TC-C05: từ chối xoá onward khi chỉ reset một step, kèm thông điệp nêu rõ ràng buộc', () => {
    const parsed = ResetStepRequest.safeParse({ ...valid, resetScope: 'step', deleteScope: 'onward' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const flat = parsed.error.flatten()
    expect(flat.fieldErrors.deleteScope?.join(' ')).toContain('resetScope')
  })

  it.each([
    ['resetScope lạ', { ...valid, resetScope: 'everything' }],
    ['deleteScope lạ', { ...valid, deleteScope: 'all' }],
    ['thiếu resetScope', { stepId: 'implementer', deleteScope: 'none' }],
    ['thiếu deleteScope', { stepId: 'implementer', resetScope: 'step' }],
    ['thiếu stepId', { resetScope: 'step', deleteScope: 'none' }],
    ['body của hợp đồng cũ', { stepId: 'implementer', cascade: true }],
  ])('TC-C06/TC-C07: từ chối %s', (_label, body) => {
    expect(ResetStepRequest.safeParse(body).success).toBe(false)
  })

  it.each(['../../etc/passwd', '..%2fdesigner', '/etc/passwd', '.hidden', '-leading-dash', ''])(
    'TC-C10: stepId %j không qua được biên',
    (stepId) => {
      expect(ResetStepRequest.safeParse({ ...valid, stepId }).success).toBe(false)
    },
  )
})
