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
