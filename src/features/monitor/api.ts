// Facade `api` cho monitor — tasks/runners/pipeline polling (issue #159 Việc 2+).
// Re-export tham chiếu tới các resource dùng chung (`jobs`, `runners`, ...)
// — không nhân bản logic, xem design.md (E0004-02) §3.1.
import {
  fetchTasks,
  patchTaskState,
  patchTaskArchive,
  createTask,
  fetchGithubIssue,
} from '../../api/resources/tasks'
import {
  submitJob,
  fetchJob,
  fetchJobs,
  fetchProposal,
  approveJob,
  discardJob,
  sendActionFeedback,
} from '../../api/resources/jobs'
import { runPipelineStep, fetchPipelineExport } from '../../api/resources/pipeline'
import {
  fetchArtifact,
  saveArtifact,
  fetchArtifactActions,
  runArtifactAction,
} from '../../api/resources/artifacts'
import { fetchRunners } from '../../api/resources/runners'

export const monitorApi = {
  fetchTasks,
  patchTaskState,
  patchTaskArchive,
  createTask,
  fetchGithubIssue,
  submitJob,
  fetchJob,
  fetchJobs,
  fetchProposal,
  approveJob,
  discardJob,
  sendActionFeedback,
  runPipelineStep,
  fetchPipelineExport,
  fetchArtifact,
  saveArtifact,
  fetchArtifactActions,
  runArtifactAction,
  fetchRunners,
}
