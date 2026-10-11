import type { emptyDraft } from './agentDraft.js'

/** Bản nháp agent — cùng shape với `emptyDraft()`. */
export type AgentDraft = ReturnType<typeof emptyDraft>

/**
 * Vai trò: sinh `AgentDraft` từ mô tả ngôn ngữ tự nhiên.
 *
 * Trả `null` khi hiện thực không sinh được (thiếu cấu hình, gọi ngoài lỗi, output
 * không dùng được) — chỗ lắp ráp `generate.ts` chuyển sang generator kế tiếp.
 * Hiện thực không được ném lỗi ra ngoài.
 */
export interface DraftGenerator {
  generate(description: string): Promise<AgentDraft | null>
}
