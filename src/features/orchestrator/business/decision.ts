/**
 * Prompt + parser cho lượt **phán đoán** của node điều phối.
 *
 * Tách khỏi `decisionLoop` để test được toàn bộ phần "đọc hiểu output agent" mà
 * không cần bus, không cần job, không cần LLM.
 */

import { DECISION_SENTINEL, OrchestratorDecision } from '../schemas/orchestrator.js'

/** Vì sao orchestrator phải hỏi agent — 3 nhánh duy nhất tốn lượt LLM. */
export type DecisionTrigger = 'gate_rejected' | 'job_failed' | 'chat'

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
}

const TRIGGER_BRIEF: Record<DecisionTrigger, string> = {
  gate_rejected: 'Cổng HITL vừa bị người duyệt TỪ CHỐI. Phản hồi của họ ở phần "Chi tiết".',
  job_failed: 'Job của một step vừa THẤT BẠI. Lỗi ở phần "Chi tiết".',
  chat: 'Người dùng vừa nhắn cho bạn. Nội dung ở phần "Chi tiết".',
}

/**
 * Prompt cho lượt quyết định. Cố ý mô tả **định dạng trả lời trước**, vì guard
 * phía sau không đoán: sai định dạng là pipeline halt tường minh.
 */
export function buildDecisionPrompt(ctx: DecisionContext): string {
  const actions = [
    `- \`start\` — chạy một step mới. \`stepId\` phải nằm trong: ${ctx.stepIds.join(', ')}`,
    '- `resume` — gửi tiếp phản hồi cho step đã chạy (giữ nguyên `current_phase`). Đặt nội dung vào `message`.',
    '- `halt` — dừng điều phối, trả quyền chạy tay lại cho người dùng.',
  ]
  const parts = [
    `# Quyết định điều phối — task ${ctx.taskId}`,
    `**Bước hiện tại:** \`${ctx.currentPhase || '(chưa có)'}\``,
    `**Tình huống:** ${TRIGGER_BRIEF[ctx.trigger]}`,
    ctx.detail?.trim() ? `## Chi tiết\n\n${ctx.detail.trim()}` : '',
    ctx.recent?.length ? `## Event gần đây\n\n${ctx.recent.map((r) => `- ${r}`).join('\n')}` : '',
    `## Hành động cho phép\n\n${actions.join('\n')}`,
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
      '⇒ pipeline sẽ **dừng** và chờ người xử lý tay.',
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
 * Đọc quyết định từ output agent.
 *
 * Mọi nhánh `{ error }` là tín hiệu **halt**, không phải tín hiệu thử lại: đoán
 * ý một output hỏng đúng là cách pipeline chạy sai mà không ai thấy.
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

  const parsed = OrchestratorDecision.safeParse(raw)
  if (!parsed.success) return { error: 'malformed decision' }

  const decision = parsed.data
  if (decision.action !== 'halt' && !stepIds.includes(decision.stepId as string)) {
    return { error: `unknown stepId: ${decision.stepId}` }
  }
  return decision
}

/** Output agent có mang quyết định không — dùng để phân biệt "chat thường" với "lệnh". */
export function hasDecisionLine(stdout: string): boolean {
  return lastDecisionLine(stdout) != null
}
