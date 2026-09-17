/**
 * Prompt + parser cho lượt **phán đoán** của node điều phối.
 *
 * Tách khỏi `decisionLoop` để test được toàn bộ phần "đọc hiểu output agent" mà
 * không cần bus, không cần job, không cần LLM.
 */

import { DECISION_SENTINEL, MAX_AGENT_CONTEXT_BYTES, OrchestratorDecision } from '../schemas/orchestrator.js'

/** Vì sao orchestrator phải hỏi agent. */
export type DecisionTrigger =
  | 'step_finished'
  | 'gate_approved'
  | 'gate_rejected'
  | 'job_failed'
  | 'chat'
  | 'manual_start'
  | 'pipeline_completed'

/** Kết quả bước vừa xong — dữ liệu agent cần để tóm tắt và quyết bước kế. */
export interface StepResult {
  stepId: string
  status: 'succeeded' | 'failed'
  artifacts: string[]
  output: string
}

export interface DecisionContext {
  taskId: string
  /** `current_phase` lúc phát sinh trigger. */
  currentPhase: string
  /** Toàn bộ step id của pipeline — tập hành động hợp lệ của agent. */
  stepIds: string[]
  trigger: DecisionTrigger
  /** Phản hồi gate / lỗi job / câu hỏi người dùng — nguyên văn. */
  detail?: string
  /** Vài event gần nhất của task, để agent thấy bối cảnh thay vì đoán. */
  recent?: string[]
  /** Chỉ có với `step_finished` / `job_failed` / `pipeline_completed`. */
  stepResult?: StepResult
  /** Gate đang chờ người (`state.hitl_pending`) — agent không được start khi có. */
  gatePending?: string
}

const TRIGGER_BRIEF: Record<DecisionTrigger, string> = {
  step_finished: 'Một step vừa CHẠY XONG. Kết quả của nó ở phần "Kết quả bước vừa xong".',
  gate_approved: 'Cổng HITL vừa được người duyệt CHẤP THUẬN — pipeline đi tiếp được.',
  gate_rejected: 'Cổng HITL vừa bị người duyệt TỪ CHỐI. Phản hồi của họ ở phần "Chi tiết".',
  job_failed: 'Job của một step vừa THẤT BẠI. Lỗi ở phần "Chi tiết".',
  chat: 'Người dùng vừa nhắn cho bạn. Nội dung ở phần "Chi tiết".',
  manual_start: 'Người dùng vừa giao quyền điều phối cho bạn. Hãy khởi động pipeline.',
  pipeline_completed: 'Pipeline đã hoàn tất. Không còn bước nào để chạy.',
}

/** Đuôi giữ nguyên: kết luận của một agent CLI nằm ở cuối output, không ở đầu. */
function tailOf(text: string): string {
  const raw = String(text ?? '')
  if (Buffer.byteLength(raw, 'utf8') <= MAX_AGENT_CONTEXT_BYTES) return raw
  const buf = Buffer.from(raw, 'utf8')
  return `…(đã cắt phần đầu)\n${buf.subarray(buf.length - MAX_AGENT_CONTEXT_BYTES).toString('utf8')}`
}

function renderStepResult(result: StepResult): string {
  const artifacts = result.artifacts.length ? result.artifacts.join(', ') : '(không có)'
  const output = tailOf(result.output).trim() || '(không có output)'
  return [
    `## Kết quả bước vừa xong`,
    '',
    `**Step:** \`${result.stepId}\` — ${result.status === 'succeeded' ? 'thành công' : 'thất bại'}`,
    `**Artifact ghi được:** ${artifacts}`,
    '',
    '```text',
    output,
    '```',
  ].join('\n')
}

/**
 * Prompt cho lượt quyết định. Cố ý mô tả **định dạng trả lời trước**, vì guard
 * phía sau không đoán: sai định dạng là pipeline halt tường minh.
 */
export function buildDecisionPrompt(ctx: DecisionContext): string {
  const actions = [
    `- \`start\` — chạy một step mới. \`stepId\` phải nằm trong: ${ctx.stepIds.join(', ')}`,
    '- `resume` — gửi tiếp phản hồi cho step đã chạy (giữ nguyên `current_phase`). Đặt nội dung vào `message`.',
    '- `summary` — ghi nhận kết quả, không chạy step nào. Dùng khi cổng HITL đang chờ người, hoặc pipeline đã xong.',
    '- `halt` — dừng điều phối, trả quyền chạy tay lại cho người dùng.',
  ]
  const constraints: string[] = []
  if (ctx.gatePending) {
    constraints.push(
      `- Cổng \`${ctx.gatePending}\` đang chờ người duyệt: chỉ được trả \`summary\` hoặc \`halt\`.`,
    )
  }
  if (ctx.trigger === 'pipeline_completed') {
    constraints.push('- Pipeline đã hoàn tất: tóm tắt toàn bộ quá trình rồi trả `summary`.')
  }
  constraints.push(
    `- Với \`start\`, đặt phần bối cảnh bạn muốn step kế đọc vào \`context\` — nó sẽ nằm trong prompt của step đó.`,
    `- Đặt tóm tắt bước vừa xong vào \`summary\`. Cả \`summary\` lẫn \`context\` tối đa ${MAX_AGENT_CONTEXT_BYTES} byte.`,
  )

  const parts = [
    `# Quyết định điều phối — task ${ctx.taskId}`,
    `**Bước hiện tại:** \`${ctx.currentPhase || '(chưa có)'}\``,
    `**Tình huống:** ${TRIGGER_BRIEF[ctx.trigger]}`,
    ctx.stepResult ? renderStepResult(ctx.stepResult) : '',
    ctx.detail?.trim() ? `## Chi tiết\n\n${ctx.detail.trim()}` : '',
    ctx.recent?.length ? `## Event gần đây\n\n${ctx.recent.map((r) => `- ${r}`).join('\n')}` : '',
    `## Hành động cho phép\n\n${actions.join('\n')}`,
    `## Ràng buộc\n\n${constraints.join('\n')}`,
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
      'Nếu bạn có tool `orchestrator_decide`, ƯU TIÊN gọi tool đó thay vì in dòng JSON — ',
      'tool cho biết ngay kết quả (dispatch được hay không) và bạn không cần đợi hết lượt. ',
      'Gọi tool rồi thì KHÔNG in lại dòng ORCHESTRATOR_DECISION nữa (double-dispatch). ',
      'Không có tool (agent CLI khác) thì vẫn dùng dòng JSON như trên. Tool `orchestrator_status` ',
      'và `orchestrator_read_output` (nếu có) cho biết trạng thái/step khác đang chạy giữa lượt, ',
      'không cần đợi lượt này kết thúc.',
    ].join('\n'),
  ]
  return parts.filter(Boolean).join('\n\n')
}

/** Dòng cuối cùng bắt đầu bằng sentinel — agent có thể "nghĩ" nhiều dòng trước đó. */
function lastDecisionLine(stdout: string): string | null {
  const lines = String(stdout ?? '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    // Fence ```…``` quanh dòng quyết định là thói quen rất hay gặp của agent CLI.
    const unfenced = line.replace(/^`+/, '').replace(/`+$/, '').trim()
    if (unfenced.startsWith(DECISION_SENTINEL)) return unfenced
  }
  return null
}

export type ParsedDecision = OrchestratorDecision | { error: string }

/**
 * Kiểm tra một quyết định đã ở dạng object (JSON đã parse) — dùng chung cho cả
 * đường sentinel (text, qua `parseDecision`) lẫn đường tool `orchestrator_decide`
 * (object trực tiếp từ tham số tool, không qua text).
 */
export function validateDecision(raw: unknown, stepIds: string[]): ParsedDecision {
  const parsed = OrchestratorDecision.safeParse(raw)
  if (!parsed.success) return { error: 'malformed decision' }

  const decision = parsed.data
  const needsStep = decision.action === 'start' || decision.action === 'resume'
  if (needsStep && !stepIds.includes(decision.stepId as string)) {
    return { error: `unknown stepId: ${decision.stepId}` }
  }
  return decision
}

/**
 * Đọc quyết định từ output agent.
 *
 * Mọi nhánh `{ error }` là tín hiệu **không dùng được lượt này**; caller quyết
 * định halt hay chuyển tiếp tất định — đoán ý một output hỏng thì không.
 */
export function parseDecision(stdout: string, stepIds: string[]): ParsedDecision {
  const line = lastDecisionLine(stdout)
  if (!line) return { error: 'no decision line' }

  let raw: unknown
  try {
    raw = JSON.parse(line.slice(DECISION_SENTINEL.length).trim())
  } catch {
    return { error: 'malformed decision json' }
  }

  return validateDecision(raw, stepIds)
}

/** Output agent có mang quyết định không — dùng để phân biệt "chat thường" với "lệnh". */
export function hasDecisionLine(stdout: string): boolean {
  return lastDecisionLine(stdout) != null
}
