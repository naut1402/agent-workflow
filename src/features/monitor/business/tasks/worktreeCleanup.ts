/**
 * "Clean up a task's worktree" as a policy, not as a git call.
 *
 * Both conditions — the task has finished, and it has no queued/running job —
 * are checked inside the SAME `withTaskLock` that performs the removal. That is
 * the whole point of this module living in `business/`: `runTaskStep` submits
 * jobs under this very lock, so checking outside it leaves a window where a job
 * accepted between the check and `git worktree remove` ends up writing into a
 * directory that just disappeared.
 *
 * Returns a plain result (no HTTP knowledge) — the controller maps it to a
 * response.
 */

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

export function cleanupTaskWorktreeForTask(
  root: string,
  repoRoot: string,
  taskId: string,
): Promise<CleanupTaskWorktreeResult> {
  return withTaskLock(root, taskId, async () => {
    // Fail closed: `.dev-state/*.json` is written by the orchestrator outside
    // this process, so an unreadable (or half-written) record is no proof the
    // task ended — unknown counts as "still running".
    const state = await readState(joinPath(root, '.dev-state', `${taskId}.json`))
    if (!state.ok || !isFinishedTaskState(state.state)) {
      return { ok: false, status: 409, error: 'task_not_finished' }
    }

    // Same predicate as `runStep.ts`: scoped to this project's data root (two
    // projects can hold tasks with the same id), and jobs written before
    // `devTeamRoot` existed in metadata still count as in-flight.
    // A separate check from the one above, not a refinement of it: a task can be
    // `archived` — hence "finished" — while a job it started is still running.
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
