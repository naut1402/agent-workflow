import { joinPath } from '../../../../backend/lib/fileHelper.js'
import { isFinishedTaskState } from '../../lib/pipelineRunGuards.js'
import { listJobs, removeTaskWorktree } from '../index.js'
import type { RemoveWorktreeResult } from '../worktree.js'
import { readState } from './index.js'
import { withTaskLock } from './state.js'

export type CleanupTaskWorktreeResult =
  | RemoveWorktreeResult
  | { ok: false; status: 409; error: 'task_not_finished' }
  | { ok: false; status: 409; error: 'task_job_in_flight'; jobId: string }

// xem docs/architecture/code/monitor.md §17
export function cleanupTaskWorktreeForTask(
  root: string,
  repoRoot: string,
  taskId: string,
): Promise<CleanupTaskWorktreeResult> {
  return withTaskLock(root, taskId, async () => {
    const state = await readState(joinPath(root, '.dev-state', `${taskId}.json`))
    if (!state.ok || !isFinishedTaskState(state.state)) {
      return { ok: false, status: 409, error: 'task_not_finished' }
    }

    const inFlight = listJobs(50).find(
      (j) =>
        j.metadata?.taskId === taskId &&
        (!j.metadata?.devTeamRoot || j.metadata.devTeamRoot === root) &&
        (j.status === 'queued' || j.status === 'running'),
    )
    if (inFlight) {
      return { ok: false, status: 409, error: 'task_job_in_flight', jobId: inFlight.id }
    }

    return removeTaskWorktree(repoRoot, taskId)
  })
}
