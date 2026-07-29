// Facade `api` cho logs — logs fetch (issue #159 Việc 2+).
import { fetchLogs, fetchJobLog } from '../../api/resources/logs'
import { fetchJobs } from '../../api/resources/jobs'

export const logsApi = {
  fetchLogs,
  fetchJobLog,
  fetchJobs,
}
