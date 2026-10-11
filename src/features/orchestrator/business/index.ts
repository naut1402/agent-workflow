/**
 * Public business surface của feature `orchestrator`.
 *
 * Peer cross-feature (`startAuthority`, `loadPipelineConfig`, `loadKnowledgeBundle`)
 * cố ý KHÔNG re-export ở đây: module bên trong feature import thẳng module sâu của
 * peer, nên lớp trung gian này không có consumer nào và audit gate bắt đúng.
 * Chiều ngược lại — monitor gọi orchestrator — **phải** dùng `import()` động để
 * không dựng vòng lúc module-eval.
 *
 * Side-effect khởi động (đăng ký subscriber + hẹn giờ quét) đặt ở cuối file này:
 * dưới `bun test` không auto-start, test tự gọi `handleEvent` / `sweepStuckTasks`.
 * (`automations` đã tách side effect sang `bootstrap.ts` cho barrel thuần — ở đây
 * vẫn là mẫu cũ, chưa tách trong đợt này.)
 */

export * from './brief.js'
export * from './decision.js'
export * from './decisionLoop.js'
export * from './orchestratorTokens.js'
export * from '../schemas/orchestrator.js'

import { startOrchestratorLoop } from './decisionLoop.js'

if (!process.env.BUN_TEST) {
  startOrchestratorLoop()
}
