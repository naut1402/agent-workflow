import type { AgentDraft, DraftGenerator } from '../DraftGenerator.js'
import { emptyDraft } from '../agentDraft.js'

/**
 * Gọi thẳng Anthropic Messages API với key từ env `ANTHROPIC_API_KEY`.
 * Trả `null` (để rơi về generator kế tiếp) khi: không có key hoặc mô tả rỗng,
 * HTTP lỗi, không thấy JSON trong câu trả lời, hoặc ném lỗi.
 */
export class AnthropicDraftGenerator implements DraftGenerator {
  async generate(description: string): Promise<AgentDraft | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || !description?.trim()) return null
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
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: `Tạo JSON AgentDraft cho agent Claude Code từ mô tả sau. Trả về CHỈ JSON hợp lệ với keys: name, description, model, skills (array), parameters (array of {name, description}), sections (object role/skills/workflow/guardrail/output), section_order.\n\nMô tả: ${description}`,
          }],
        }),
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) return null
      const data: any = await res.json()
      const text = data.content?.[0]?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0])
      return { ...emptyDraft(), ...parsed, sections: { ...emptyDraft().sections, ...parsed.sections } }
    } catch {
      return null
    }
  }
}
