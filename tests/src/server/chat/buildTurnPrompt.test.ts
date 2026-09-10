import { describe, expect, test } from 'bun:test'
import { buildTurnPrompt } from '../../../../src/features/nl-chat/business/nlChatSession'
import { renderNlChatCatalog } from '../../../../src/features/nl-chat/business/nlChatCatalog'
import { KNOWN_AUTOMATION_EVENT_TYPES } from '../../../../src/features/automations/business/index'

describe('buildTurnPrompt', () => {
  test.each(['task', 'pipeline', 'agent', 'automation'] as const)('turn 1 (%s) always states the output contract', (entityType) => {
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

  test.each(['task', 'pipeline', 'agent', 'automation'] as const)(
    'turn > 1 (%s) still reminds the output contract, briefly',
    (entityType) => {
      const prompt = buildTurnPrompt({ entityType, turnIndex: 3, message: 'câu trả lời tiếp theo' })
      expect(prompt).toContain('===DRAFT_READY===')
      expect(prompt).toContain(`Người dùng (lượt 3): câu trả lời tiếp theo`)
    },
  )

  // Practice case của Tf2fec630: "tạo task … dùng pipeline XXX". Catalog phải
  // vào được prompt của entityType = task, không chỉ 'pipeline' như trước.
  test('turn 1 task carries the rendered catalog and the profileName rule', () => {
    const extraContext = renderNlChatCatalog(
      {
        agents: [],
        skills: [],
        pipelineProfiles: ['quality-first-pipeline'],
        hasGlobalPipeline: true,
        automations: [],
        unreadable: [],
      },
      'task',
    )
    const prompt = buildTurnPrompt({ entityType: 'task', turnIndex: 1, message: 'tạo task dùng pipeline đó', extraContext })

    expect(prompt).toContain('quality-first-pipeline')
    expect(prompt).toContain('[PIPELINE PROFILE]')
    expect(prompt).toContain('"profileName" phải là MỘT TÊN CÓ TRONG danh sách [PIPELINE PROFILE]')
  })

  test('automation hint follows the real CreateAutomationRequest shape (triggers[]/actions[])', () => {
    const prompt = buildTurnPrompt({ entityType: 'automation', turnIndex: 1, message: 'm' })

    expect(prompt).toContain('"triggers"')
    expect(prompt).toContain('"actions"')
    expect(prompt).toContain('"repeat"')
    expect(prompt).toContain('"timer"')
    // Kind cũ (`trigger` số ít, `kind: interval`) đã bỏ khỏi schema — hint mô
    // tả sai thì draft chốt ra bị Zod trả 400 ở POST /api/automations.
    expect(prompt).not.toContain('"kind": "interval"')
    expect(prompt).not.toContain('"kind": "time"')
  })

  // Drift guard: `AUTOMATION_EVENT_TYPES_HINT` là bản chép tay của
  // `KNOWN_AUTOMATION_EVENT_TYPES` (nlChatSession.ts cố ý không có import nào).
  // Lệch thì im lặng — hint sai → draft bị Zod trả 400 ở POST /api/automations.
  test('automation hint liệt kê đủ KNOWN_AUTOMATION_EVENT_TYPES', () => {
    const prompt = buildTurnPrompt({ entityType: 'automation', turnIndex: 1, message: 'm' })
    for (const t of KNOWN_AUTOMATION_EVENT_TYPES) expect(prompt).toContain(t)
  })

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

  test('turn > 1 reminds the builder to stick to the turn-1 catalog', () => {
    const prompt = buildTurnPrompt({ entityType: 'task', turnIndex: 4, message: 'm' })
    expect(prompt).toContain('chỉ dùng ref/tên có trong catalog')
  })

  test('turn > 1 ignores extraContext (only relevant for turn 1)', () => {
    const prompt = buildTurnPrompt({ entityType: 'pipeline', turnIndex: 2, message: 'm', extraContext: 'SHOULD_NOT_APPEAR' })
    expect(prompt).not.toContain('SHOULD_NOT_APPEAR')
  })
})
