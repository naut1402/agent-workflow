import { emptyDraft, heuristicDraftFromDescription } from '../../../core/contracts/agentMarkdown.js'

/**
 * Generate an AgentDraft from a natural-language description. Uses the Anthropic
 * API when ANTHROPIC_API_KEY is set, otherwise falls back to a local heuristic.
 */
export async function generateDraftFromNl(description: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey && description?.trim()) {
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
      if (res.ok) {
        const data: any = await res.json()
        const text = data.content?.[0]?.text || ''
        const match = text.match(/\{[\s\S]*\}/)
        if (match) {
          const parsed = JSON.parse(match[0])
          return { ...emptyDraft(), ...parsed, sections: { ...emptyDraft().sections, ...parsed.sections } }
        }
      }
    } catch {
      /* fallback heuristic */
    }
  }
  return heuristicDraftFromDescription(description || '')
}
