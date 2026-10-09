// xem docs/architecture/code/nl-chat.md §3
const HEADING = 'Tập tin người dùng đính kèm (đọc trực tiếp từ đường dẫn):'

export interface AttachmentRef {
  name: string
  path: string
}

export function buildAttachmentBlock(files: AttachmentRef[]): string {
  if (files.length === 0) return ''
  return [HEADING, ...files.map((f) => `- ${f.name} → ${f.path}`)].join('\n')
}

export function appendAttachments(text: string, files: AttachmentRef[]): string {
  const block = buildAttachmentBlock(files)
  if (!block) return text
  return text ? `${text}\n\n${block}` : block
}
