import { joinPath } from '../../../../backend/lib/fileHelper.js'

// Hàm đọc nằm ở `./reads.js` — barrel này re-export lại nên public surface không
// đổi, nhưng caller chỉ cần ĐỌC (vd tiến trình stdio ở `mcp/`) import thẳng
// `./reads.js` để không kéo theo `runStep.js` → runner → job queue + sqlite +
// `node:child_process`. Cùng động cơ với `../peers.ts`.
export { MACHINE_FILES, resolveArtifact, listArtifacts, readState, collectTasks } from './reads.js'

/** Path to a task's flow-profile JSON. */
export function flowProfilePath(root: string, id: string): string {
  return joinPath(root, 'flow-profiles', `${id}.json`)
}

export { createTask, renderRequestMarkdown } from './create.js'
export type { CreateTaskInput, CreateTaskResult, CreatedTask } from './create.js'
export { runTaskStep } from './runStep.js'
export type { RunTaskStepInput, RunTaskStepResult } from './runStep.js'
export { createQa } from './qa.js'
export type { CreateQaResult } from './qa.js'
// `startAuthority` cố ý không re-export ở đây: mọi caller — `runner/business/index.ts`,
// `orchestrator/business/`, và test — đều import thẳng `./startAuthority.js`, nên lớp
// trung gian này là dead weight mà audit gate bắt đúng.
export { cleanupTaskWorktreeForTask } from './worktreeCleanup.js'
