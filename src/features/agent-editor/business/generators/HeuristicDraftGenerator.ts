import type { AgentDraft, DraftGenerator } from '../DraftGenerator.js'
import { heuristicDraftFromDescription } from '../agentMarkdown.js'

/** Generator cục bộ, không gọi mạng — luôn trả draft, dùng làm mắt cuối của chuỗi dự phòng. */
export class HeuristicDraftGenerator implements DraftGenerator {
  async generate(description: string): Promise<AgentDraft> {
    return heuristicDraftFromDescription(description || '')
  }
}
