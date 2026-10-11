import { MAX_CHAT_MESSAGE_CHARS } from '../schemas/nlChat'

/**
 * Nối bản draft NGƯỜI DÙNG ĐANG SỬA vào message gửi cho builder.
 *
 * Không có khối này thì bản draft agent "nhớ" là bản nó tự sinh, không phải bản
 * trên màn hình — mọi chỉnh tay của người dùng biến mất ở lượt chat kế tiếp.
 *
 * Văn bản dưới đây đi vào prompt cho agent, không lên màn hình — cùng quy ước
 * với `attachmentPrompt.ts` / `knowledgePrompt.ts`, KHÔNG qua i18n.
 */

const HEADING =
  'Đây là bản draft NGƯỜI DÙNG ĐANG SỬA trên màn hình (đã gồm cả chỉnh tay của họ). ' +
  'Hãy sửa tiếp TRÊN BẢN NÀY rồi trả lại draft đầy đủ, đừng dựng lại từ đầu:'

export interface AppendDraftResult {
  /** Chuỗi thật sự gửi lên API. */
  message: string
  /** false = draft bị bỏ vì vượt ngưỡng — UI phải cảnh báo. */
  attached: boolean
}

export function appendDraft(
  text: string,
  draft: Record<string, unknown> | null,
): AppendDraftResult {
  if (!draft) return { message: text, attached: false }
  const block = `${HEADING}\n\`\`\`json\n${JSON.stringify(draft, null, 2)}\n\`\`\``
  const merged = text ? `${text}\n\n${block}` : block
  // Đo trên chuỗi ĐÃ GỘP: file đính kèm + knowledge đã được nối vào `text` trước
  // khi tới đây, nên chỉ chuỗi cuối cùng mới là thứ server đo.
  // Vượt ngưỡng thì gửi `text` trần — nửa khối JSON còn tệ hơn không gửi gì.
  if (merged.length > MAX_CHAT_MESSAGE_CHARS) return { message: text, attached: false }
  return { message: merged, attached: true }
}
