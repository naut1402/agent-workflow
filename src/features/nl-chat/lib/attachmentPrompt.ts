/**
 * Turns uploaded attachments into the block appended to the outgoing message.
 *
 * The chat sends PATHS, not contents: the agent opens the files itself, which
 * keeps the message routes unchanged and works with every provider CLI.
 *
 * This text goes into the prompt for the agent, not onto the screen — it stays
 * Vietnamese to match `buildTurnPrompt` and does NOT go through i18n.
 */

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
