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

  // T536c80fd: không còn khái niệm "catalog của lượt 1". Caller không cấp
  // catalog (facade `NlChatBusiness`) vẫn phải nhận câu nhắc chống bịa ref,
  // nhưng câu đó KHÔNG được trỏ người đọc về lượt 1 nữa.
  test('turn > 1 without extraContext still reminds the anti-fabrication rule', () => {
    const prompt = buildTurnPrompt({ entityType: 'task', turnIndex: 4, message: 'm' })
    expect(prompt).toContain('chỉ dùng ref/tên có trong catalog')
    expect(prompt).not.toContain('lượt 1')
  })

  // Ca hồi quy trực tiếp của bug: lượt > 1 trước đây bỏ qua `extraContext`,
  // nên pipeline tạo giữa phiên không bao giờ tới được agent.
  test('turn > 1 cũng nối extraContext', () => {
    const prompt = buildTurnPrompt({ entityType: 'pipeline', turnIndex: 2, message: 'm', extraContext: 'SHOULD_APPEAR' })
    expect(prompt).toContain('SHOULD_APPEAR')
  })

  // Thứ tự bắt buộc: nhắc contract → catalog → message. Catalog nằm sau
  // message thì rule "không khớp thì hỏi lại" không còn ràng buộc câu vừa nhận.
  test('turn > 1 đặt extraContext TRƯỚC message của người dùng', () => {
    const prompt = buildTurnPrompt({ entityType: 'pipeline', turnIndex: 2, message: 'm', extraContext: 'SHOULD_APPEAR' })
    expect(prompt.indexOf('SHOULD_APPEAR')).toBeLessThan(prompt.indexOf('Người dùng (lượt 2)'))
  })

  // Lượt > 1 nhận đúng khối catalog mà lượt 1 nhận — không có nhánh render thứ hai.
  test('turn > 1 carries the freshly rendered catalog, not a static reminder', () => {
    const extraContext = renderNlChatCatalog(
      {
        agents: [],
        skills: [],
        pipelineProfiles: ['pipeline-vua-tao'],
        hasGlobalPipeline: false,
        automations: [],
        unreadable: [],
      },
      'task',
    )
    const prompt = buildTurnPrompt({ entityType: 'task', turnIndex: 3, message: 'đổi sang pipeline vừa tạo', extraContext })

    expect(prompt).toContain('[PIPELINE PROFILE]')
    expect(prompt).toContain('pipeline-vua-tao')
  })
})
