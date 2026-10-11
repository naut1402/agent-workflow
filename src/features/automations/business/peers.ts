/**
 * Cổng peer duy nhất của automations (`feature-architecture-guideline.md` §2.6):
 * mọi symbol lấy từ feature khác đi qua file này, mỗi symbol lấy thẳng từ
 * barrel của feature chủ. Module trong `business/` import peer từ đây;
 * controller lấy phần nó cần qua `./index.js`.
 *
 * Tách khỏi `index.ts` để executor trong `actions/` import peer mà không tạo
 * vòng `index.ts` ⇄ executor.
 */

export {
  submitJob,
  loadJob,
  resolveStepRunnerId,
  listRunners,
  getConnection,
  providerFamilyOf,
} from '../../runner/business/index.js'
export type { JobRecord } from '../../runner/business/index.js'
export { createTask, resolveOrchestration, runTaskStep } from '../../monitor/business/index.js'
export { fetchUrlSafe, profilesDir } from '../../agent-editor/business/index.js'
export { dispatchOrchestrator } from '../../orchestrator/business/index.js'
