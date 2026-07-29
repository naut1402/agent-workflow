// Facade `api` cho settings — project registry/fs/autoscan/github-tokens
// config (issue #159 Việc 2+).
import {
  fetchProjects,
  fetchProject,
  addProject,
  removeProject,
  browseFs,
  fetchAutoscanConfig,
  saveAutoscanConfig,
  runAutoscan,
  fetchGithubTokensConfig,
  saveGithubTokensConfig,
} from '../../api/resources/workspace'

export const settingsApi = {
  fetchProjects,
  fetchProject,
  addProject,
  removeProject,
  browseFs,
  fetchAutoscanConfig,
  saveAutoscanConfig,
  runAutoscan,
  fetchGithubTokensConfig,
  saveGithubTokensConfig,
}
