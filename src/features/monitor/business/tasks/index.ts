import { joinPath } from '../../../../backend/lib/fileHelper.js'

// xem docs/architecture/code/monitor.md §4
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
export { cleanupTaskWorktreeForTask } from './worktreeCleanup.js'
