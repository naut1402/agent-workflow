// Facade `api` cho runner — runner/connection/credential CRUD (issue #159 Việc 2+).
//
// `jobPolicies` (seam server-side để tránh flag kiểu `isChatFeedback` bake
// thẳng vào `server/runners/jobQueue.ts`, issue #159): giữ nguyên quyết định
// từ E0004-01 — không thêm field vào `RegistryContext`/sửa `jobQueue.ts` vì
// flag đó chưa tồn tại trên nhánh này (không có consumer thật, xem
// design.md E0004-02 §4.1 "Commit 6"). Chỉ facade phía client được đăng ký.
import {
  fetchRunners,
  saveRunner,
  deleteRunner,
  setDefaultRunner,
  fetchCredentials,
  saveCredential,
  fetchConnections,
  saveConnection,
  deleteConnection,
  scanLocalCommands,
} from '../../api/resources/runners'
import { fetchJobs, fetchJob, submitJob } from '../../api/resources/jobs'

export const runnerApi = {
  fetchRunners,
  saveRunner,
  deleteRunner,
  setDefaultRunner,
  fetchCredentials,
  saveCredential,
  fetchConnections,
  saveConnection,
  deleteConnection,
  scanLocalCommands,
  fetchJobs,
  fetchJob,
  submitJob,
}
