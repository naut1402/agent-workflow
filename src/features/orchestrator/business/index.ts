/**
 * Public business surface của feature `orchestrator`.
 *
 * Cross-feature dep được re-export ở đây (quy ước barrel); module bên trong
 * feature gọi thẳng barrel của feature khác theo đúng tiền lệ của `automations`
 * (`runAction.ts`). Chiều ngược lại — monitor gọi orchestrator — **phải** dùng
 * `import()` động để không dựng vòng lúc module-eval.
 *
 * Side-effect khởi động đặt ở cuối file, cùng mẫu với `automations/business/index.ts`:
 * dưới `bun test` không auto-start, test tự gọi `handleEvent` / `sweepStuckTasks`.
 */

export * from './brief.js'
export * from './decision.js'
export * from './decisionLoop.js'
export * from '../schemas/orchestrator.js'

/** Peer: quyền start + trạng thái điều phối (owned by monitor). */
export {
  assertStartAllowed,
  resolveOrchestration,
} from '../../monitor/business/tasks/startAuthority.js'
/** Peer: cấu hình pipeline nhiều tầng (owned by pipeline-editor). */
export { loadPipelineConfig } from '../../pipeline-editor/business/pipeline/index.js'
/** Peer: knowledge bundle cho phần Knowledge của brief (owned by knowledge). */
export { loadKnowledgeBundle } from '../../knowledge/business/index.js'

import { startOrchestratorLoop } from './decisionLoop.js'

if (!process.env.BUN_TEST) {
  startOrchestratorLoop()
}
