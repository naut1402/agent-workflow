/**
 * Turns the knowledge the user picked into the block appended to the outgoing
 * message — the twin of `attachmentPrompt.ts`.
 *
 * The chat sends PATHS, not contents: the agent opens the files itself, which
 * keeps the message routes unchanged and works with every provider CLI.
 *
 * This text goes into the prompt for the agent, not onto the screen — it stays
 * Vietnamese to match `buildTurnPrompt` and does NOT go through i18n.
 */

const HEADING = 'Knowledge người dùng chỉ định (đọc trực tiếp từ đường dẫn):'

export interface KnowledgeRef {
  id: string
  title?: string
  path?: string
  error?: string
}

export function buildKnowledgeBlock(items: KnowledgeRef[]): string {
  // Item lỗi (id lạ, quá ngưỡng byte) không có `path` — bỏ qua thay vì gửi một
  // dòng agent không mở được.
  const usable = items.filter((k) => k.path)
  if (!usable.length) return ''
  return [HEADING, ...usable.map((k) => `- ${k.title || k.id} [${k.id}] → ${k.path}`)].join('\n')
}

export function appendKnowledge(text: string, items: KnowledgeRef[]): string {
  const block = buildKnowledgeBlock(items)
  if (!block) return text
  return text ? `${text}\n\n${block}` : block
}
