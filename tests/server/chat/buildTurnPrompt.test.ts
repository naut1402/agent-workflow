import { describe, expect, test } from 'bun:test'
import { buildTurnPrompt } from '../../../server/chat/buildTurnPrompt'

describe('buildTurnPrompt', () => {
  test.each(['task', 'pipeline', 'agent'] as const)('turn 1 (%s) always states the output contract', (entityType) => {
    const prompt = buildTurnPrompt({ entityType, turnIndex: 1, message: 'tôi muốn tạo cái gì đó' })
    expect(prompt).toContain('===DRAFT_READY===')
    expect(prompt).toContain('Người dùng (lượt 1): tôi muốn tạo cái gì đó')
  })

  test('turn 1 pipeline appends extraContext (catalog agent refs)', () => {
    const prompt = buildTurnPrompt({
      entityType: 'pipeline',
      turnIndex: 1,
      message: 'm',
      extraContext: 'Danh sách agent ref hợp lệ:\n- dashboard:foo',
    })
    expect(prompt).toContain('dashboard:foo')
  })

  test.each(['task', 'pipeline', 'agent'] as const)(
    'turn > 1 (%s) still reminds the output contract, briefly',
    (entityType) => {
      const prompt = buildTurnPrompt({ entityType, turnIndex: 3, message: 'câu trả lời tiếp theo' })
      expect(prompt).toContain('===DRAFT_READY===')
      expect(prompt).toContain(`Người dùng (lượt 3): câu trả lời tiếp theo`)
    },
  )

  test('turn > 1 ignores extraContext (only relevant for turn 1)', () => {
    const prompt = buildTurnPrompt({ entityType: 'pipeline', turnIndex: 2, message: 'm', extraContext: 'SHOULD_NOT_APPEAR' })
    expect(prompt).not.toContain('SHOULD_NOT_APPEAR')
  })
})
