import { applyRenameAction } from './state.js'

const MAX_NAME_LENGTH = 60

/** First non-empty line of the prompt, markdown-heading prefix stripped, capped to 60 chars. */
export function buildHeuristicTaskName(prompt: string): string {
  const firstLine = prompt.split('\n').find((l) => l.trim()) ?? ''
  const cleaned = firstLine.replace(/^#+\s*/, '').trim()
  return cleaned.length > MAX_NAME_LENGTH ? `${cleaned.slice(0, MAX_NAME_LENGTH - 3)}…` : cleaned
}

/** Ask the Anthropic API for a short task title — null on missing key/error/empty result. */
async function callLlmForName(prompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !prompt.trim()) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 30,
        messages: [
          {
            role: 'user',
            content: `Đặt 1 tên ngắn gọn (tối đa 60 ký tự, tiếng Việt, không markdown, không dấu ngoặc kép) mô tả task sau. Trả về CHỈ tên, không giải thích gì thêm.\n\n${prompt}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const text = String(data.content?.[0]?.text ?? '').trim().replace(/^["']|["']$/g, '')
    return text || null
  } catch {
    return null
  }
}

/**
 * Fire-and-forget: derive a task name from its prompt and patch it in, without
 * blocking task creation. Guards on `expectedMtime` so a rename the user made
 * while this was running is never clobbered — a 409 there just means "skip".
 */
export async function generateAndApplyTaskName(
  root: string,
  taskId: string,
  prompt: string,
  expectedMtime: number,
): Promise<void> {
  const name = (await callLlmForName(prompt)) ?? buildHeuristicTaskName(prompt)
  if (!name) return
  await applyRenameAction(root, taskId, { name, mtime: expectedMtime }).catch(() => {})
}
