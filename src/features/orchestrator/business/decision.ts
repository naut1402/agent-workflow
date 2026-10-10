/**
 * Prompt + parser cho lượt phán đoán của node điều phối.
 *
 * Tách khỏi `decisionLoop` để test được toàn bộ phần "đọc hiểu output agent" mà
 * không cần bus, không cần job, không cần LLM.
 */

import {
  DECISION_SENTINEL,
  MAX_AGENT_CONTEXT_BYTES,
  MAX_STEP_RESULT_BYTES,
  OrchestratorDecision,
} from '../schemas/orchestrator.js'
import { stripBalancedFence } from '../../../shared/lib/orchestrator.js'
import type { DecisionRoute } from './mcpRoute.js'

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
  /** Kết quả nút con trả về — KHÔNG phải log/context làm việc của nó. */
  result: string
  /** True khi nút con không trả `STEP_SUMMARY` và đây chỉ là đuôi output. */
  fromTail?: boolean
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
  /** Job step đang chạy của task lúc giao lượt (không tính job điều phối); `null` khi không có. */
  activeStep?: { stepId: string | null; status: string } | null
  /** `orchestrator.system_prompt` từ pipeline.yaml — hướng dẫn tự do do người vận hành cấu hình. */
  extraSystemPrompt?: string
  /** Bundle knowledge đã render, ứng với `orchestrator.knowledge_inputs`. */
  knowledgeText?: string
  /**
   * Tuyến ra lệnh đã chốt cho lượt này (`resolveDecisionRoute`). Vắng ⇒
   * `'sentinel'`: mọi caller/test cũ giữ nguyên hành vi, ký tự với ký tự.
   */
  route?: DecisionRoute
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
function tailOf(text: string, limit: number): string {
  const raw = String(text ?? '')
  if (Buffer.byteLength(raw, 'utf8') <= limit) return raw
  const buf = Buffer.from(raw, 'utf8')
  let start = buf.length - limit
  // Ngân sách tính bằng byte, nhưng điểm cắt phải rơi vào ranh giới ký tự: cắt
  // giữa một ký tự nhiều byte (tiếng Việt là chuyện thường ngày ở đây) thì
  // `toString` trả về U+FFFD. Bỏ qua các byte nối (10xxxxxx) ở đầu lát cắt.
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
  return `…(đã cắt phần đầu)\n${buf.subarray(start).toString('utf8')}`
}

/**
 * Khối kết quả của nút con. Cố ý KHÔNG mang log thô: context làm việc của nút
 * con ở lại phiên của nút con, cha chỉ nhận `STEP_SUMMARY` nó tự soạn (hoặc
 * đuôi output khi nó không trả) cùng danh sách artifact để đọc chi tiết.
 *
 * Heading `###` chứ không `##`: khối này nằm lồng giữa các mục `##` khác của
 * prompt, và tài liệu artifact có thể nhúng lại prompt rồi cắt theo section.
 */
function renderStepResult(result: StepResult): string {
  const artifacts = result.artifacts.length ? result.artifacts.join(', ') : '(không có)'
  const body = tailOf(result.result, MAX_STEP_RESULT_BYTES).trim() || '(nút con không trả kết quả)'
  return [
    `### Kết quả bước vừa xong`,
    '',
    `**Step:** \`${result.stepId}\` — ${result.status === 'succeeded' ? 'thành công' : 'thất bại'}`,
    `**Artifact ghi được:** ${artifacts}`,
    result.fromTail
      ? '**Nguồn:** đuôi output (nút con không trả `STEP_SUMMARY`)'
      : '**Nguồn:** `STEP_SUMMARY` do nút con trả về',
    '',
    '```text',
    body,
    '```',
    '',
    'Chi tiết đầy đủ nằm trong artifact ở thư mục task — đọc file khi cần,',
    'đừng suy đoán từ đoạn trên.',
  ].join('\n')
}

function renderCurrentState(ctx: DecisionContext): string {
  const gate = ctx.gatePending ? `\`${ctx.gatePending}\`` : 'không có'
  const active = ctx.activeStep
    ? `\`${ctx.activeStep.stepId ?? '(không rõ step)'}\` — ${ctx.activeStep.status}`
    : 'không có step nào đang chạy'
  return [
    '## Trạng thái hiện tại',
    '',
    'Snapshot lúc giao lượt này — đủ để quyết, không cần hỏi lại dashboard.',
    '',
    `- **Cổng chờ duyệt:** ${gate}`,
    `- **Step đang chạy:** ${active}`,
  ].join('\n')
}

/**
 * Giao thức sentinel — ra lệnh bằng dòng JSON cuối output.
 *
 * ⚠️ Nội dung giữ Y NGUYÊN bản trước khi tách hàm: đây là đường mặc định của
 * mọi lượt không có MCP, và test characterization chốt nó ký tự với ký tự.
 */
function renderSentinelProtocol(): string {
  return [
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
  ].join('\n')
}

/**
 * Giao thức MCP — ra lệnh bằng tool `orchestrator_decide`.
 *
 * Hai dòng fallback cuối là phần *runtime* của yêu cầu "không kết nối được thì
 * dùng cách cũ", 🚫 không phải thừa: `route` chốt ở server chỉ nói job SẼ có
 * tool, còn việc CLI có kết nối được tới MCP server hay không xảy ra sau đó và
 * server không biết. Thiếu hai dòng này, một lần MCP rụng giữa lượt là pipeline
 * đứng im không lý do. Chi phí ~35 token, so với ~250 token của khối sentinel.
 *
 * Agent gọi tool RỒI in thêm dòng sentinel cũng không thi hành hai lần: chốt
 * `directDecisionApplied` được đóng trước khi `applyDecision` chạy.
 */
function renderMcpProtocol(): string {
  return [
    '## Cách ra lệnh (bắt buộc)',
    '',
    'Gọi tool MCP `orchestrator_decide`. Tool có hiệu lực NGAY, không cần chờ hết lượt.',
    'Tham số đúng bằng các trường đã mô tả ở "Hành động cho phép" và "Ràng buộc" bên trên.',
    '',
    'Gọi tool xong thì KHÔNG in thêm dòng JSON nào — lệnh đã được thi hành.',
    '',
    'Nếu `orchestrator_decide` KHÔNG có trong danh sách tool của bạn, hoặc gọi nó trả lỗi:',
    // Ví dụ phải CHẠY ĐƯỢC, không phải placeholder: agent chỉ đọc tới đây khi
    // tuyến chính đã hỏng — đúng lúc cần ít mơ hồ nhất. Chép nguyên ví dụ có
    // `…` vào JSON là `validateDecision` từ chối rồi `recoverFromBadTurn`.
    `in dòng cuối cùng của output đúng dạng \`${DECISION_SENTINEL} {"action":"resume","stepId":"implementer","reason":"...","message":"..."}\``,
    'để dashboard thi hành thay — KHÔNG gọi API điều phối bằng shell (`curl`).',
  ].join('\n')
}

/**
 * Prompt cho lượt quyết định. Cố ý mô tả định dạng trả lời trước, vì guard
 * phía sau không đoán: sai định dạng là pipeline halt tường minh.
 *
 * Khối giao thức chọn theo `ctx.route` — đây là chỗ hiện thực "quyết định ở
 * runtime theo trạng thái MCP", 🚫 không chép cứng một định dạng vào template.
 */
export function buildDecisionPrompt(ctx: DecisionContext): string {
  const actions = [
    `- \`start\` — chạy một step mới. \`stepId\` phải nằm trong: ${ctx.stepIds.join(', ')}`,
    '- `resume` — gửi tiếp phản hồi cho step đã chạy (giữ nguyên `current_phase`). Đặt nội dung vào `message`.',
    '- `summary` — ghi nhận kết quả, không chạy step nào. Dùng khi cổng HITL đang chờ người, hoặc pipeline đã xong.',
    '- `halt` — dừng điều phối, trả quyền chạy tay lại cho người dùng.',
    '- `respawn` — chạy một PHIÊN MỚI (bỏ hoàn toàn lịch sử hội thoại cũ) cho một step ĐÃ TỪNG chạy xong ' +
      '(thành công hoặc thất bại), bất kể `current_phase` hiện tại là gì (kể cả khi pipeline đã `completed`). ' +
      'KHÔNG đổi `current_phase`/gate/artifact của step khác. `stepId` phải nằm trong: ' + ctx.stepIds.join(', '),
  ]
  const constraints: string[] = []
  if (ctx.gatePending) {
    constraints.push(
      `- Cổng \`${ctx.gatePending}\` đang chờ người duyệt: chỉ được trả \`summary\`, \`halt\`, hoặc \`respawn\` ` +
        `(respawn không đụng gate đang chờ vì nó không đổi current_phase).`,
    )
  }
  if (ctx.trigger === 'pipeline_completed') {
    constraints.push('- Pipeline đã hoàn tất: tóm tắt toàn bộ quá trình rồi trả `summary`.')
  }
  constraints.push(
    `- Với \`start\`/\`respawn\`, đặt phần bối cảnh bạn muốn step kế đọc vào \`context\` — nó sẽ nằm trong prompt của step đó.`,
    `- Đặt tóm tắt bước vừa xong vào \`summary\`. Cả \`summary\` lẫn \`context\` tối đa ${MAX_AGENT_CONTEXT_BYTES} byte.`,
  )

  const parts = [
    `# Quyết định điều phối — task ${ctx.taskId}`,
    `**Bước hiện tại:** \`${ctx.currentPhase || '(chưa có)'}\``,
    `**Tình huống:** ${TRIGGER_BRIEF[ctx.trigger]}`,
    ctx.extraSystemPrompt?.trim()
      ? `## Hướng dẫn bổ sung (cấu hình orchestrator)\n\n${ctx.extraSystemPrompt.trim()}`
      : '',
    renderCurrentState(ctx),
    ctx.stepResult ? renderStepResult(ctx.stepResult) : '',
    ctx.detail?.trim() ? `## Chi tiết\n\n${ctx.detail.trim()}` : '',
    ctx.recent?.length ? `## Event gần đây\n\n${ctx.recent.map((r) => `- ${r}`).join('\n')}` : '',
    ctx.knowledgeText?.trim() ? `## Knowledge\n\n${ctx.knowledgeText.trim()}` : '',
    `## Hành động cho phép\n\n${actions.join('\n')}`,
    `## Ràng buộc\n\n${constraints.join('\n')}`,
    ctx.route === 'mcp' ? renderMcpProtocol() : renderSentinelProtocol(),
  ]
  return parts.filter(Boolean).join('\n\n')
}

/** Dòng cuối cùng bắt đầu bằng sentinel — agent có thể "nghĩ" nhiều dòng trước đó. */
function lastDecisionLine(stdout: string): string | null {
  const lines = String(stdout ?? '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    // Fence ```…``` quanh dòng quyết định là thói quen rất hay gặp của agent CLI.
    // Chỉ bóc khi fence CÂN hai đầu — cùng quy ước với `stepSummaryOf`, để một
    // backtick kết câu (code span) không bị ăn mất.
    const unfenced = stripBalancedFence(lines[i])
    if (unfenced.startsWith(DECISION_SENTINEL)) return unfenced
  }
  return null
}

export type ParsedDecision = OrchestratorDecision | { error: string }

/**
 * Kiểm tra một quyết định đã ở dạng object (JSON đã parse) — dùng chung cho cả
 * đường sentinel (text, qua `parseDecision`) lẫn đường `POST /api/orchestrator/decide`
 * (object đã parse từ JSON body, không qua text).
 */
export function validateDecision(raw: unknown, stepIds: string[]): ParsedDecision {
  const parsed = OrchestratorDecision.safeParse(raw)
  if (!parsed.success) return { error: 'malformed decision' }

  const decision = parsed.data
  const needsStep = decision.action === 'start' || decision.action === 'resume' || decision.action === 'respawn'
  if (needsStep && !stepIds.includes(decision.stepId as string)) {
    return { error: `unknown stepId: ${decision.stepId}` }
  }
  return decision
}

/**
 * Đọc quyết định từ output agent.
 *
 * Mọi nhánh `{ error }` là tín hiệu không dùng được lượt này; caller quyết
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
