import type { AgentDraft, DraftGenerator } from './DraftGenerator.js'
import { AnthropicDraftGenerator } from './generators/AnthropicDraftGenerator.js'
import { HeuristicDraftGenerator } from './generators/HeuristicDraftGenerator.js'

/**
 * Chỗ lắp ráp duy nhất biết hiện thực `DraftGenerator` cụ thể.
 * Thử lần lượt các generator LLM; generator nào trả `null` thì sang cái kế tiếp,
 * hết thì rơi về heuristic (luôn trả draft).
 */
const llmGenerators: DraftGenerator[] = [new AnthropicDraftGenerator()]
const fallbackGenerator = new HeuristicDraftGenerator()

/** Generate an AgentDraft from a natural-language description. */
export async function generateDraftFromNl(description: string): Promise<AgentDraft> {
  for (const generator of llmGenerators) {
    const draft = await generator.generate(description)
    if (draft) return draft
  }
  return fallbackGenerator.generate(description)
}
