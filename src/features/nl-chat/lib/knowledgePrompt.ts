// xem docs/architecture/code/nl-chat.md §3
const HEADING = 'Knowledge người dùng chỉ định (đọc trực tiếp từ đường dẫn):'

export interface KnowledgeRef {
  id: string
  title?: string
  path?: string
  error?: string
}

export function buildKnowledgeBlock(items: KnowledgeRef[]): string {
  const usable = items.filter((k) => k.path)
  if (!usable.length) return ''
  return [HEADING, ...usable.map((k) => `- ${k.title || k.id} [${k.id}] → ${k.path}`)].join('\n')
}

export function appendKnowledge(text: string, items: KnowledgeRef[]): string {
  const block = buildKnowledgeBlock(items)
  if (!block) return text
  return text ? `${text}\n\n${block}` : block
}
