import { describe, expect, test } from 'bun:test'
import { buildTurnPrompt } from '../../../../src/features/nl-chat/business/nlChatSession'

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

  test('auto mode (no entityType): turn 1 gives all 3 schemas and asks for the wrapper draft', () => {
    const prompt = buildTurnPrompt({ turnIndex: 1, message: 'tôi cần một pipeline review' })
    expect(prompt).toContain('===DRAFT_READY===')
    expect(prompt).toContain('entityType = task')
    expect(prompt).toContain('entityType = pipeline')
    expect(prompt).toContain('entityType = agent')
    expect(prompt).toContain('"draft"')
  })

  test('auto mode: turn > 1 still reminds the wrapper contract', () => {
    const prompt = buildTurnPrompt({ turnIndex: 2, message: 'tiếp' })
    expect(prompt).toContain('===DRAFT_READY===')
    expect(prompt).toContain('entityType')
  })

  test('turn > 1 ignores extraContext (only relevant for turn 1)', () => {
    const prompt = buildTurnPrompt({ entityType: 'pipeline', turnIndex: 2, message: 'm', extraContext: 'SHOULD_NOT_APPEAR' })
    expect(prompt).not.toContain('SHOULD_NOT_APPEAR')
  })
})
