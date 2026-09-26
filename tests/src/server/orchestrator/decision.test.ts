import { describe, expect, test } from 'bun:test'
import {
  buildDecisionPrompt,
  hasDecisionLine,
  parseDecision,
} from '../../../../src/features/orchestrator/business/decision.js'
import { DECISION_SENTINEL } from '../../../../src/features/orchestrator/schemas/orchestrator.js'

// D1 của design: output agent không đọc được thì pipeline **halt tường minh**,
// không đoán. Mọi case ở đây chấm đúng một thứ quan sát được — giá trị trả về
// của `parseDecision` — vì đó là thứ quyết định dispatch hay halt.

const STEPS = ['investigator', 'implementer', 'reviewer']

function line(json: string): string {
  return `${DECISION_SENTINEL} ${json}`
}

describe('parseDecision — quyết định hợp lệ', () => {
  test('start kèm stepId có trong pipeline', () => {
    const d = parseDecision(line('{"action":"start","stepId":"reviewer","reason":"xong rồi"}'), STEPS)
    expect(d).toEqual({ action: 'start', stepId: 'reviewer', reason: 'xong rồi' })
  })

  test('resume kèm message — message là nội dung gửi cho step', () => {
    const d = parseDecision(line('{"action":"resume","stepId":"implementer","message":"sửa 2 điểm"}'), STEPS)
    expect(d).toEqual({ action: 'resume', stepId: 'implementer', message: 'sửa 2 điểm' })
  })

  test('halt không cần stepId', () => {
    expect(parseDecision(line('{"action":"halt","reason":"bó tay"}'), STEPS)).toEqual({
      action: 'halt',
      reason: 'bó tay',
    })
  })

  test('agent "nghĩ" nhiều dòng trước — lấy dòng sentinel CUỐI cùng', () => {
    const stdout = [
      'Tôi xem xét thấy reviewer yêu cầu sửa.',
      line('{"action":"halt"}'),
      'Không, nghĩ lại thì nên resume.',
      line('{"action":"resume","stepId":"implementer","message":"sửa lại"}'),
    ].join('\n')
    expect(parseDecision(stdout, STEPS)).toMatchObject({ action: 'resume', stepId: 'implementer' })
  })

  test('dòng quyết định bị bọc trong fence ``` vẫn đọc được', () => {
    const stdout = ['```', line('{"action":"start","stepId":"reviewer"}'), '```'].join('\n')
    expect(parseDecision(stdout, STEPS)).toMatchObject({ action: 'start', stepId: 'reviewer' })
  })
})

// Td2be3c3e TC06/TC05 (đọc qua schema) — `respawn` bắt buộc `stepId` như
// `start`/`resume`, nhưng KHÔNG bắt buộc `message` (khác `resume`), và stepId
// phải nằm trong pipeline hiện tại — cùng cơ chế `start`/`resume` đã có.
describe('parseDecision — respawn (Td2be3c3e)', () => {
  test('respawn kèm stepId hợp lệ, không kèm message — hợp lệ', () => {
    const d = parseDecision(line('{"action":"respawn","stepId":"implementer"}'), STEPS)
    expect(d).toEqual({ action: 'respawn', stepId: 'implementer' })
  })

  test('respawn mang context/summary cho brief mới', () => {
    const d = parseDecision(
      line('{"action":"respawn","stepId":"implementer","summary":"S","context":"revert filter"}'),
      STEPS,
    )
    expect(d).toEqual({ action: 'respawn', stepId: 'implementer', summary: 'S', context: 'revert filter' })
  })

  test('respawn thiếu stepId ⇒ malformed decision (TC06)', () => {
    expect(parseDecision(line('{"action":"respawn"}'), STEPS)).toEqual({ error: 'malformed decision' })
  })

  test('respawn với stepId rỗng ⇒ malformed decision (TC06)', () => {
    expect(parseDecision(line('{"action":"respawn","stepId":""}'), STEPS)).toEqual({ error: 'malformed decision' })
  })

  test('respawn với stepId không có trong pipeline ⇒ unknown stepId (TC05)', () => {
    expect(parseDecision(line('{"action":"respawn","stepId":"pr-creator"}'), STEPS)).toEqual({
      error: 'unknown stepId: pr-creator',
    })
  })
})

describe('parseDecision — mọi nhánh hỏng đều trả error (⇒ halt), không đoán', () => {
  test('không có dòng sentinel', () => {
    expect(parseDecision('chỉ là một câu trả lời bình thường', STEPS)).toEqual({ error: 'no decision line' })
  })

  test('output rỗng', () => {
    expect(parseDecision('', STEPS)).toEqual({ error: 'no decision line' })
  })

  test('JSON hỏng', () => {
    expect(parseDecision(line('{action: resume'), STEPS)).toEqual({ error: 'malformed decision json' })
  })

  test('action lạ', () => {
    expect(parseDecision(line('{"action":"reset","stepId":"implementer"}'), STEPS)).toEqual({
      error: 'malformed decision',
    })
  })

  test('start/resume thiếu stepId', () => {
    expect(parseDecision(line('{"action":"start"}'), STEPS)).toEqual({ error: 'malformed decision' })
  })

  // Resume với prompt rỗng là một lượt chạy vô nghĩa của step — chặn ở schema
  // để nó rơi vào nhánh halt, thay vì submit job với `userPrompt: ''`.
  test('resume thiếu message', () => {
    expect(parseDecision(line('{"action":"resume","stepId":"implementer"}'), STEPS)).toEqual({
      error: 'malformed decision',
    })
  })

  test('resume với message chỉ toàn khoảng trắng', () => {
    expect(parseDecision(line('{"action":"resume","stepId":"implementer","message":"   "}'), STEPS)).toEqual({
      error: 'malformed decision',
    })
  })

  test('stepId không có trong pipeline', () => {
    expect(parseDecision(line('{"action":"start","stepId":"pr-creator"}'), STEPS)).toEqual({
      error: 'unknown stepId: pr-creator',
    })
  })
})

describe('hasDecisionLine — phân biệt "ra lệnh" với "trò chuyện"', () => {
  test('có sentinel', () => {
    expect(hasDecisionLine(line('{"action":"halt"}'))).toBe(true)
  })

  test('không có sentinel ⇒ chỉ là hội thoại, orchestrator không làm gì', () => {
    expect(hasDecisionLine('Chào bạn, pipeline đang chờ reviewer.')).toBe(false)
  })
})

describe('buildDecisionPrompt', () => {
  test('liệt kê đúng tập step hợp lệ và nêu định dạng bắt buộc', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'gate_rejected',
      detail: 'thiếu test cho nhánh lỗi',
    })
    for (const step of STEPS) expect(prompt).toContain(step)
    expect(prompt).toContain(DECISION_SENTINEL)
    expect(prompt).toContain('thiếu test cho nhánh lỗi')
  })

  test('không có detail thì không chèn section rỗng', () => {
    const prompt = buildDecisionPrompt({ taskId: 'T1', currentPhase: 'implementer', stepIds: STEPS, trigger: 'chat' })
    expect(prompt).not.toContain('## Chi tiết')
  })
})

// AC-3/AC-4 — lượt điều phối phải mang được kết quả bước vừa xong và bối cảnh
// cho bước kế. Chấm trên hai bề mặt quan sát được: quyết định parse ra, và
// prompt gửi cho agent (đọc lại được ở `job.userPrompt`).
describe('parseDecision — summary/context do agent soạn (TC-15, TC-20)', () => {
  test('summary đi kèm mọi action, kể cả summary không cần stepId', () => {
    expect(
      parseDecision(line('{"action":"summary","summary":"step-1 xong, cổng đang chờ người"}'), STEPS),
    ).toEqual({ action: 'summary', summary: 'step-1 xong, cổng đang chờ người' })
  })

  test('start mang context cho bước kế', () => {
    expect(
      parseDecision(line('{"action":"start","stepId":"reviewer","summary":"S","context":"C"}'), STEPS),
    ).toEqual({ action: 'start', stepId: 'reviewer', summary: 'S', context: 'C' })
  })

  test('summary/context vắng mặt vẫn hợp lệ — agent không bắt buộc soạn', () => {
    expect(parseDecision(line('{"action":"start","stepId":"reviewer"}'), STEPS)).toEqual({
      action: 'start',
      stepId: 'reviewer',
    })
  })
})

describe('buildDecisionPrompt — bối cảnh đủ cho AC-3/AC-4', () => {
  // TC-15: agent phải thấy kết quả của step vừa xong, không chỉ tên nó.
  test('kết quả bước vừa xong (artifact + output) nằm trong prompt', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
      stepResult: {
        stepId: 'implementer',
        status: 'succeeded',
        artifacts: ['design.md', 'review.md'],
        output: 'M2-marker ở cuối output',
      },
    })
    expect(prompt).toContain('implementer')
    expect(prompt).toContain('design.md')
    expect(prompt).toContain('M2-marker ở cuối output')
  })

  // TC-16: output rất dài ⇒ prompt vẫn hữu hạn, phần bị cắt được NÓI RA, và
  // dấu hiệu nằm ở CUỐI output thì phải còn (kết luận agent CLI nằm ở cuối).
  test('output rất dài ⇒ giữ đuôi, nói rõ đã cắt, không phình vô hạn', () => {
    const marker = 'M3-cuoi-output'
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
      stepResult: {
        stepId: 'implementer',
        status: 'succeeded',
        artifacts: [],
        output: `${'x'.repeat(300_000)}\n${marker}`,
      },
    })
    expect(prompt).toContain(marker)
    expect(prompt).toContain('đã cắt phần đầu')
    expect(prompt).not.toContain('x'.repeat(100_000))
  })

  // TC-21 — bất biến an toàn: node điều phối KHÔNG được tự duyệt cổng thay người.
  // Td2be3c3e: `respawn` cố ý KHÔNG bị chặn bởi gate (nó không đổi
  // `current_phase`) — prompt phải liệt kê nó cạnh `summary`/`halt`, không
  // phải một danh sách hai action như trước khi có `respawn`.
  test('cổng đang chờ người ⇒ prompt chỉ cho phép summary/halt/respawn', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
      gatePending: 'hitl-review',
    })
    expect(prompt).toContain('hitl-review')
    expect(prompt).toMatch(/chỉ được trả `summary`, `halt`, hoặc `respawn`/)
  })

  test('pipeline đã xong ⇒ prompt yêu cầu tóm tắt rồi summary', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'completed',
      stepIds: STEPS,
      trigger: 'pipeline_completed',
    })
    expect(prompt).toContain('hoàn tất')
    expect(prompt).toContain('`summary`')
  })

  test('event gần đây được đưa vào — agent thấy bối cảnh cả pipeline, không chỉ step đầu', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
      recent: ['2026-01-01 task.advanced — implementer', '2026-01-02 hitl.pending — hitl-review'],
    })
    expect(prompt).toContain('Event gần đây')
    expect(prompt).toContain('hitl.pending')
  })
})
