import type { NlChatEntityType } from './parseBuilderOutput.js'

export interface BuildTurnPromptInput {
  /**
   * Target entity, when the caller pinned one. Omitted (auto mode) for the
   * floating chat surface: the user just chats, and the agent decides which
   * of task/pipeline/agent the draft is for.
   */
  entityType?: NlChatEntityType | null
  /** 1-based turn counter within the chat session. */
  turnIndex: number
  /** The user's latest message for this turn. */
  message: string
  /**
   * Extra context to append on turn 1 only — e.g. the valid `agent` refs from
   * the catalog, needed so a `pipeline` draft only references real agents.
   */
  extraContext?: string
}

const OUTPUT_CONTRACT_HEADER = [
  'Bạn là agent hội thoại "nl-chat-builder" — phỏng vấn người dùng bằng ngôn ngữ tự nhiên để tạo cấu hình cho hệ thống dev-team-dashboard.',
  '',
  'Output contract (BẮT BUỘC tuân theo ở MỌI lượt trả lời):',
  '- Nếu còn thiếu thông tin bắt buộc: trả lời thuần văn bản, đặt câu hỏi ngắn gọn cho người dùng. KHÔNG có sentinel, KHÔNG có JSON.',
  '- Nếu đã đủ thông tin để chốt draft: dòng ĐẦU TIÊN của output phải là chính xác `===DRAFT_READY===`, theo sau là một fenced code block ```json chứa draft.',
].join('\n')

const AUTO_MODE_HEADER = [
  'Người dùng đang chat tự do — CHƯA chọn sẵn loại đối tượng cần tạo.',
  'Bạn phải tự suy ra người dùng muốn tạo `task`, `pipeline` hay `agent` từ nội dung hội thoại;',
  'nếu chưa rõ thì hỏi lại bằng văn bản thuần (đây cũng là câu hỏi bình thường, không phải form).',
  'Nếu người dùng chỉ hỏi han/trao đổi mà chưa muốn tạo gì, cứ trả lời như một trợ lý bình thường — KHÔNG ép chốt draft.',
  'Khi chốt draft, JSON trong code block phải là wrapper: { "entityType": "task" | "pipeline" | "agent", "draft": { ...draft đúng schema của entityType đó... } }.',
].join('\n')

function schemaHintFor(entityType?: NlChatEntityType | null): string {
  if (!entityType) {
    return [
      AUTO_MODE_HEADER,
      '',
      schemaHintFor('task'),
      '',
      schemaHintFor('pipeline'),
      '',
      schemaHintFor('agent'),
    ].join('\n')
  }
  switch (entityType) {
    case 'task':
      return [
        'entityType = task: JSON phải là subset field của CreateTaskRequest.',
        'Tối thiểu bắt buộc: { "taskId": string, "prompt": string }.',
        'Các field khác (source, profileName, pipeline, knowledgeInputs, ...) là optional — chỉ thêm khi người dùng cung cấp, giữ nguyên default của Zod nếu không.',
      ].join('\n')
    case 'pipeline':
      return [
        'entityType = pipeline: JSON phải theo shape CreateTaskPipeline: { "steps": [ ... ] }.',
        'Mỗi step phải dùng field "agent" là một ref NẰM TRONG danh sách catalog agent hợp lệ đã cung cấp ở lượt đầu tiên — không được bịa ref không có trong danh sách.',
      ].join('\n')
    case 'agent':
      return [
        'entityType = agent: JSON phải theo đúng shape AgentDraft hiện có của dashboard (name, description, model, skills, sections, section_order).',
        'Tái dùng đúng schema draft agent đã có, không tự bịa field mới.',
      ].join('\n')
    default:
      return ''
  }
}

/**
 * Build the `userPrompt` sent to `submitJob`/`sendTaskFeedback` for one chat
 * turn. The CLI session itself remembers conversation history (resumed via
 * `sessionId`), so every turn only needs to (re)state the output contract
 * briefly plus the user's new message — not the full transcript.
 */
export function buildTurnPrompt(input: BuildTurnPromptInput): string {
  const parts: string[] = []
  if (input.turnIndex <= 1) {
    parts.push(OUTPUT_CONTRACT_HEADER)
    parts.push('')
    parts.push(schemaHintFor(input.entityType))
    if (input.extraContext?.trim()) {
      parts.push('')
      parts.push(input.extraContext.trim())
    }
    parts.push('')
    parts.push(`Người dùng (lượt 1): ${input.message}`)
  } else {
    const draftShape = input.entityType
      ? `draft đúng schema ${input.entityType}`
      : 'wrapper { "entityType": ..., "draft": ... } đúng schema của entityType bạn đã suy ra'
    parts.push(`(Nhắc lại ngắn gọn output contract: nếu đủ thông tin, dòng đầu tiên phải là ${'`'}===DRAFT_READY===${'`'} theo sau là fenced ${'```'}json chứa ${draftShape}; nếu chưa đủ, chỉ hỏi lại bằng văn bản thuần.)`)
    parts.push('')
    parts.push(`Người dùng (lượt ${input.turnIndex}): ${input.message}`)
  }
  return parts.join('\n')
}
