import { describe, expect, test } from 'bun:test'
import {
  buildDecisionPrompt,
  hasDecisionLine,
  parseDecision,
} from '../../../../src/features/orchestrator/business/decision.js'
import type { StepResult } from '../../../../src/features/orchestrator/business/decision.js'
import { stepResultOf } from '../../../../src/features/orchestrator/business/decisionLoop.js'
import {
  DECISION_SENTINEL,
  MAX_AGENT_CONTEXT_BYTES,
  MAX_STEP_RESULT_BYTES,
  STEP_SUMMARY_PREFIX,
} from '../../../../src/features/orchestrator/schemas/orchestrator.js'

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
        result: 'M2-marker ở cuối output',
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
        result: `${'x'.repeat(300_000)}\n${marker}`,
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

// T8eb14482 — TC-CFG-01/02/04: `orchestrator.system_prompt`/`knowledge_inputs`
// (qua `resolveOrchestration`) nối vào prompt bằng đúng 2 field mới của
// `DecisionContext`. Test ở đây chấm mức unit (input field ⇒ output prompt);
// đường nối thật từ pipeline.yaml → `askAgent` được chấm ở `decisionLoop.test.ts`.
describe('buildDecisionPrompt — cấu hình orchestrator (TC-CFG-01/02/04)', () => {
  test('TC-CFG-01: có extraSystemPrompt + knowledgeText ⇒ cả hai đều nằm trong prompt', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
      extraSystemPrompt: 'Review có PO thì quay lại implementer.',
      knowledgeText: 'Nội dung knowledge đã render.',
    })
    expect(prompt).toContain('## Hướng dẫn bổ sung (cấu hình orchestrator)')
    expect(prompt).toContain('Review có PO thì quay lại implementer.')
    expect(prompt).toContain('## Knowledge')
    expect(prompt).toContain('Nội dung knowledge đã render.')
  })

  test('TC-CFG-02/04: không khai (undefined) ⇒ không sinh heading nào', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
    })
    expect(prompt).not.toContain('Hướng dẫn bổ sung')
    expect(prompt).not.toContain('## Knowledge')
  })

  test('TC-CFG-04: chuỗi rỗng/toàn khoảng trắng ⇒ tương đương không khai', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
      extraSystemPrompt: '   ',
      knowledgeText: '',
    })
    expect(prompt).not.toContain('Hướng dẫn bổ sung')
    expect(prompt).not.toContain('## Knowledge')
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * T6427b18c — nhóm C: kênh con → cha chỉ mang KẾT QUẢ.
 *
 * Trước fix, cả `job.stdout` thô của nút con đi vào prompt điều phối với ngân
 * sách 8 KB, và phiên điều phối được resume qua nhiều lượt nên mỗi step xong là
 * một lần cộng dồn log của con vào cùng cuộc hội thoại. Bề mặt chấm ở đây là
 * CHUỖI PROMPT — đúng thứ đi vào `job.userPrompt` của lượt điều phối.
 * ──────────────────────────────────────────────────────────────────────────── */

function promptWith(over: Partial<StepResult> = {}): string {
  return buildDecisionPrompt({
    taskId: 'T1',
    currentPhase: 'reviewer',
    stepIds: STEPS,
    trigger: 'step_finished',
    stepResult: {
      stepId: 'investigator',
      status: 'succeeded',
      artifacts: ['investigate.md'],
      result: 'Đã khảo sát 3 module, ghi investigate.md.',
      fromTail: false,
      ...over,
    },
  })
}

/** Nội dung bên trong fence ```text — khối kết quả thật sự gửi cho nút cha. */
function resultBlock(prompt: string): string {
  const m = prompt.match(/```text\n([\s\S]*?)\n```/)
  if (!m) throw new Error('prompt không có khối kết quả ```text')
  return m[1]
}

describe('T6427b18c nhóm C — khối kết quả trong prompt điều phối', () => {
  test('TC-26: giá trị hằng ngân sách', () => {
    expect(MAX_STEP_RESULT_BYTES).toBe(2 * 1024)
    expect(STEP_SUMMARY_PREFIX).toBe('STEP_SUMMARY:')
    // Ngân sách của `agentContext` (cha → con) KHÔNG đổi theo task này.
    expect(MAX_AGENT_CONTEXT_BYTES).toBe(8 * 1024)
  })

  test('TC-27: prompt mang stepId + artifact, KHÔNG mang log thô của nút con', () => {
    const prompt = promptWith()
    expect(prompt).toContain('investigator')
    expect(prompt).toContain('investigate.md')
    expect(prompt).toContain('Đã khảo sát 3 module, ghi investigate.md.')
    expect(prompt).toContain('### Kết quả bước vừa xong')
    expect(prompt).toContain('**Nguồn:** `STEP_SUMMARY` do nút con trả về')

    // Phép đo trực tiếp của AC-3: chuỗi mồi nằm trong stdout của nút con nhưng
    // NGOÀI dòng `STEP_SUMMARY` thì không được xuất hiện ở prompt của nút cha.
    const leak = '__CHILD_CONTEXT_LEAK__'
    const job = { stdout: `${leak}\nđang sửa file…\nSTEP_SUMMARY: xong phần khảo sát` } as any
    const viaJob = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
      stepResult: stepResultOf(job, 'investigator', 'succeeded'),
    })
    expect(viaJob).toContain('xong phần khảo sát')
    expect(viaJob).not.toContain(leak)
  })

  test('TC-28: kết quả quá dài bị cắt theo ngân sách, giữ ĐUÔI', () => {
    const head = 'H'.repeat(200)
    const tail = '<<<TAIL_MARKER>>>'.repeat(12)
    const prompt = promptWith({ result: `${head}${'x'.repeat(300_000)}${tail}` })
    const block = resultBlock(prompt)

    expect(block).toContain('<<<TAIL_MARKER>>>')
    expect(block).not.toContain(head)
    expect(block).toContain('(đã cắt phần đầu)')
    // Nhãn cắt là phần thêm vào, phần nội dung phải nằm trong ngân sách.
    expect(Buffer.byteLength(block, 'utf8')).toBeLessThanOrEqual(
      MAX_STEP_RESULT_BYTES + Buffer.byteLength('…(đã cắt phần đầu)\n', 'utf8'),
    )
  })

  test('TC-29: biên ngân sách — vừa đủ thì không cắt', () => {
    // (a) đúng 2048 byte ASCII ⇒ nguyên vẹn
    const exact = 'a'.repeat(MAX_STEP_RESULT_BYTES)
    const a = resultBlock(promptWith({ result: exact }))
    expect(a).toBe(exact)
    expect(a).not.toContain('(đã cắt phần đầu)')

    // (b) thêm đúng 1 byte ⇒ cắt, giữ đuôi
    const b = resultBlock(promptWith({ result: `Z${exact}` }))
    expect(b).toContain('(đã cắt phần đầu)')
    expect(b).not.toContain('Z' + 'a'.repeat(10))
    expect(b.endsWith('a'.repeat(10))).toBe(true)

    // (c) tiếng Việt nhiều byte: điểm cắt rơi đúng ranh giới ký tự
    const c = resultBlock(promptWith({ result: 'á'.repeat(1200) }))
    expect(c).toContain('(đã cắt phần đầu)')
    expect(c).not.toContain('�')
  })

  test('TC-30: fromTail: true ⇒ prompt khai rõ nguồn là đuôi output', () => {
    const prompt = promptWith({ fromTail: true })
    expect(prompt).toContain('**Nguồn:** đuôi output (nút con không trả `STEP_SUMMARY`)')
    expect(prompt).not.toContain('**Nguồn:** `STEP_SUMMARY` do nút con trả về')
  })

  test('TC-31: fromTail vắng mặt xử như false', () => {
    const prompt = buildDecisionPrompt({
      taskId: 'T1',
      currentPhase: 'reviewer',
      stepIds: STEPS,
      trigger: 'step_finished',
      stepResult: { stepId: 'investigator', status: 'succeeded', artifacts: [], result: 'xong' },
    })
    expect(prompt).toContain('**Nguồn:** `STEP_SUMMARY` do nút con trả về')
  })

  test('TC-32: không có artifact', () => {
    expect(promptWith({ artifacts: [] })).toContain('**Artifact ghi được:** (không có)')
  })

  test('TC-33: nút con không trả gì ⇒ nói thẳng, không để khối rỗng', () => {
    const block = resultBlock(promptWith({ result: '   \n  ', fromTail: true }))
    expect(block).toBe('(nút con không trả kết quả)')
  })

  test('TC-34: step thất bại hiển thị đúng trạng thái', () => {
    expect(promptWith({ status: 'failed' })).toContain('— thất bại')
    expect(promptWith({ status: 'succeeded' })).toContain('— thành công')
  })

  test('TC-35: prompt không dạy gọi API điều phối bằng curl — ra lệnh bằng dòng JSON cuối', () => {
    const prompt = promptWith()
    expect(prompt).not.toContain('curl -s')
    expect(prompt).not.toContain('/api/orchestrator/')
    expect(prompt).not.toContain('DASHBOARD_ORCHESTRATOR_TOKEN')
    expect(prompt).toContain('KHÔNG gọi API điều phối bằng shell')
  })
})

describe('buildDecisionPrompt — trạng thái hiện tại được tiêm vào prompt', () => {
  const base = { taskId: 'T1', currentPhase: 'design', stepIds: ['investigate', 'design'], trigger: 'chat' as const }

  test('có step đang chạy và cổng đang chờ ⇒ nêu cả hai', () => {
    const prompt = buildDecisionPrompt({
      ...base,
      gatePending: 'design-review',
      activeStep: { stepId: 'design', status: 'running' },
    })
    expect(prompt).toContain('## Trạng thái hiện tại')
    expect(prompt).toContain('- **Cổng chờ duyệt:** `design-review`')
    expect(prompt).toContain('- **Step đang chạy:** `design` — running')
  })

  test('không có step đang chạy, không cổng ⇒ nói thẳng, không bỏ trống', () => {
    const prompt = buildDecisionPrompt({ ...base, activeStep: null })
    expect(prompt).toContain('- **Cổng chờ duyệt:** không có')
    expect(prompt).toContain('- **Step đang chạy:** không có step nào đang chạy')
  })

  test('job không mang pipelineStepId ⇒ vẫn báo đang chạy', () => {
    const prompt = buildDecisionPrompt({ ...base, activeStep: { stepId: null, status: 'queued' } })
    expect(prompt).toContain('- **Step đang chạy:** `(không rõ step)` — queued')
  })
})

// ═══ Tf2f484e2 · Nhóm C — khối giao thức ra lệnh theo tuyến ═══════════════════
//
// Bề mặt quan sát: CHUỖI PROMPT sinh ra cho một lượt điều phối. `ctx.route` là
// thứ duy nhất đổi, nên mọi ca dưới đây so hai prompt dựng từ CÙNG input.
//
// ⚠️ TC-C01/TC-C02 là characterization (`testing.md` §5): chúng chốt prompt của
// đường mặc định ký tự với ký tự. Sửa `renderSentinelProtocol` là phải sửa ở
// đây — và đó đúng là lúc cần một người đọc lại, vì mọi lượt không có MCP đi
// qua chuỗi này.

const ROUTE_BASE = {
  taskId: 'T-route',
  currentPhase: 'reviewer',
  stepIds: STEPS,
  trigger: 'gate_rejected' as const,
  detail: 'thiếu test cho nhánh lỗi',
  recent: ['job.finished implementer', 'gate.rejected hitl-review'],
  gatePending: 'hitl-review',
  activeStep: null,
}

const SENTINEL_HEADING = '## Định dạng trả lời (bắt buộc)'
const MCP_HEADING = '## Cách ra lệnh (bắt buộc)'

/** Khối giao thức = phần đuôi prompt kể từ heading của tuyến đó. */
function protocolBlock(prompt: string): string {
  const idx = prompt.includes(MCP_HEADING) ? prompt.indexOf(MCP_HEADING) : prompt.indexOf(SENTINEL_HEADING)
  expect(idx).toBeGreaterThan(-1)
  return prompt.slice(idx)
}

/** Phần prompt TRƯỚC khối giao thức — bối cảnh, phải giống nhau ở cả 2 tuyến. */
function contextPart(prompt: string): string {
  return prompt.slice(0, prompt.length - protocolBlock(prompt).length)
}

describe('Nhóm C — tuyến `sentinel` giữ nguyên giao thức cũ', () => {
  // TC-C01 — golden. Nguyên văn, không `toContain` từng mảnh: đây là hợp đồng
  // với agent, và một từ đổi là một lớp agent đọc sai.
  test('TC-C01: khối giao thức sentinel đúng NGUYÊN VĂN bản hiện hành', () => {
    const block = protocolBlock(buildDecisionPrompt({ ...ROUTE_BASE, route: 'sentinel' }))
    expect(block).toBe(
      [
        '## Định dạng trả lời (bắt buộc)',
        '',
        'Dòng **cuối cùng** của output phải đúng dạng sau, JSON một dòng:',
        '',
        '```',
        `${DECISION_SENTINEL} {"action":"resume","stepId":"implementer","reason":"...","message":"..."}`,
        '```',
        '',
        'Không có dòng này, hoặc JSON hỏng, hoặc `stepId` không nằm trong danh sách trên',
        '⇒ orchestrator tự chuyển tiếp theo thứ tự pipeline mà không có bối cảnh bạn soạn.',
        '',
        'Ra lệnh bằng đúng dòng này. Trạng thái task, kết quả bước vừa xong và event gần đây',
        'đã nằm trong prompt — KHÔNG gọi API điều phối bằng shell (`curl`) để lấy lại hay để ra lệnh.',
      ].join('\n'),
    )
  })

  // TC-C02 — ⚠️ lưới chống hồi quy cho TOÀN BỘ ca dựng prompt đang có: mọi
  // caller cũ (và mọi test cũ trong file này) không truyền `route`.
  test('TC-C02: vắng `route` ⇒ prompt GIỐNG HỆT `route: sentinel`, ký tự với ký tự', () => {
    const withoutRoute = buildDecisionPrompt(ROUTE_BASE)
    const sentinel = buildDecisionPrompt({ ...ROUTE_BASE, route: 'sentinel' })
    expect(withoutRoute).toBe(sentinel)
    // Và cả hai phải là đường SENTINEL, không phải cùng rơi về một nhánh khác.
    expect(withoutRoute).toContain(SENTINEL_HEADING)
    expect(withoutRoute).not.toContain(MCP_HEADING)
  })

  test('TC-C02 (b): giá trị `route` lạ cũng rơi về sentinel, 🚫 không ném', () => {
    for (const bogus of ['MCP', 'mcp ', '', null, undefined, 1, {}]) {
      const prompt = buildDecisionPrompt({ ...ROUTE_BASE, route: bogus as any })
      expect(prompt).toBe(buildDecisionPrompt({ ...ROUTE_BASE, route: 'sentinel' }))
    }
  })
})

describe('Nhóm C — tuyến `mcp` dạy gọi tool', () => {
  const mcpPrompt = () => buildDecisionPrompt({ ...ROUTE_BASE, route: 'mcp' })

  // TC-C03
  test('TC-C03: dạy gọi `orchestrator_decide` và nói rõ gọi xong KHÔNG in thêm JSON', () => {
    const block = protocolBlock(mcpPrompt())
    expect(block).toContain('`orchestrator_decide`')
    expect(block).toContain('KHÔNG in thêm dòng JSON nào')
    // 🚫 Khối "định dạng trả lời" đầy đủ của tuyến sentinel không còn ở đây.
    expect(mcpPrompt()).not.toContain(SENTINEL_HEADING)
    expect(block).not.toContain('Dòng **cuối cùng** của output phải đúng dạng sau')
  })

  // TC-C04 — ⚠️ phần RUNTIME của AC2: tuyến chốt ở server chỉ là dự đoán, MCP
  // có thể rụng sau đó. Lối thoát phải tồn tại, và tồn tại ĐÚNG MỘT lần.
  test('TC-C04: còn đúng MỘT lối thoát sentinel, kèm điều kiện dùng nó', () => {
    const block = protocolBlock(mcpPrompt())
    expect(block).toContain('KHÔNG có trong danh sách tool của bạn, hoặc gọi nó trả lỗi')
    const occurrences = block.split(DECISION_SENTINEL).length - 1
    expect(occurrences).toBe(1)
    // Ví dụ fallback phải CHẠY ĐƯỢC: chép nguyên nó vào output là một quyết
    // định hợp lệ, không phải placeholder `…` mà `validateDecision` từ chối.
    const example = block.slice(block.indexOf(DECISION_SENTINEL) + DECISION_SENTINEL.length)
    const json = example.slice(example.indexOf('{'), example.indexOf('}') + 1)
    expect(parseDecision(`${DECISION_SENTINEL} ${json}`, STEPS)).toMatchObject({
      action: 'resume',
      stepId: 'implementer',
    })
    // Rào "🚫 không curl" có ở CẢ HAI tuyến — tuyến mcp không được đánh rơi nó.
    expect(block).toContain('KHÔNG gọi API điều phối bằng shell (`curl`)')
  })

  /**
   * TC-C05 — ⚠️ CA NÀY KHÔNG ĐẠT KỲ VỌNG CỦA `test-spec.md` §3.3.
   *
   * Spec kỳ vọng khối giao thức tuyến `mcp` "ngắn hơn đáng kể" (gợi ý ≤ 50%).
   * Số đo thật trên code hiện tại thì NGƯỢC LẠI: khối `mcp` **dài hơn** khối
   * `sentinel`. Nguyên nhân có thật và có chủ ý — hai dòng fallback của TC-C04
   * được giữ lại (lưới an toàn khi MCP rụng giữa lượt), và vòng review thứ 2
   * còn mở rộng chúng (ví dụ chạy được thay cho `…`, thêm rào `curl`).
   *
   * Vì vậy ca này được viết thành **characterization**: nó khoá số đo hiện tại
   * để mọi thay đổi khối giao thức đều lộ ra, 🚫 không khẳng định một mục tiêu
   * tiết kiệm mà code không đạt. Lợi ích token thật của thay đổi nằm ở chỗ
   * khác — agent gọi tool thay vì sinh một dòng JSON cuối output — và nó không
   * đo được bằng độ dài prompt. Xem `test-result.md` › "Lệch spec".
   */
  test('TC-C05: số đo độ dài khối giao thức hai tuyến (characterization)', () => {
    const sentinelBlock = protocolBlock(buildDecisionPrompt({ ...ROUTE_BASE, route: 'sentinel' }))
    const mcpBlock = protocolBlock(mcpPrompt())

    expect(Buffer.byteLength(sentinelBlock, 'utf8')).toBe(663)
    expect(Buffer.byteLength(mcpBlock, 'utf8')).toBe(681)
    // Mốc trần: khối mcp 🚫 không được phình thêm quá 20% so với sentinel. Vượt
    // là dấu hiệu cả hai giao thức đang bị dán vào cùng một prompt.
    expect(Buffer.byteLength(mcpBlock, 'utf8')).toBeLessThan(
      Buffer.byteLength(sentinelBlock, 'utf8') * 1.2,
    )
  })

  // TC-C06 — tuyến chỉ đổi CÁCH RA LỆNH, 🚫 không đổi bối cảnh.
  test('TC-C06: mọi phần ngoài khối giao thức GIỐNG HỆT giữa hai tuyến', () => {
    const sentinel = buildDecisionPrompt({ ...ROUTE_BASE, route: 'sentinel' })
    const mcp = mcpPrompt()
    expect(contextPart(mcp)).toBe(contextPart(sentinel))
    // Chiều dương: bối cảnh đó thật sự có nội dung, không phải chuỗi rỗng.
    for (const needle of [
      'T-route',
      '`reviewer`',
      'thiếu test cho nhánh lỗi',
      'job.finished implementer',
      ...STEPS,
    ]) {
      expect(contextPart(mcp)).toContain(needle)
    }
  })

  /**
   * TC-C07 — ⚠️ LỆCH SPEC, ghi lại nguyên nhân thay vì giả vờ phủ.
   *
   * `test-spec.md` kỳ vọng cả hai prompt "nói rõ: chỉ trò chuyện thì không ra
   * lệnh". Prompt điều phối HÔM NAY **không** có câu đó ở bất kỳ tuyến nào —
   * câu đó chỉ nằm trong `docs/template/agents/orchestrator.md`, và nó đã ở đó
   * từ trước thay đổi này (TC-C02 chứng minh prompt không đổi). Đây là khoảng
   * trống có sẵn, 🚫 không phải hồi quy của task này.
   *
   * Phần KIỂM ĐƯỢC vẫn được kiểm: lượt chat đi qua đúng cùng một đường với mọi
   * trigger khác, và tuyến 🚫 không làm lệch điều đó.
   */
  test('TC-C07: lượt chat — hai tuyến chỉ khác khối giao thức, không khác gì nữa', () => {
    const chatBase = { ...ROUTE_BASE, trigger: 'chat' as const, detail: 'tiến độ sao rồi?' }
    const sentinel = buildDecisionPrompt({ ...chatBase, route: 'sentinel' })
    const mcp = buildDecisionPrompt({ ...chatBase, route: 'mcp' })

    expect(contextPart(mcp)).toBe(contextPart(sentinel))
    expect(contextPart(mcp)).toContain('Người dùng vừa nhắn cho bạn')
    // Guard thật của "chat ≠ lệnh" nằm ở chỗ đọc output, không ở prompt: không
    // in dòng sentinel ⇒ không có quyết định nào được đọc ra.
    expect(hasDecisionLine('Tiến độ đang ổn, implementer vừa xong.')).toBe(false)
    expect(parseDecision('Tiến độ đang ổn.', STEPS)).toEqual({ error: 'no decision line' })
  })
})
