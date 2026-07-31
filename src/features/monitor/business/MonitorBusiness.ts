import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { collectTasks, flowProfilePath, createTask, readState } from './tasks/index.js'
import { advanceStepOnJobSuccess, applyArchiveAction, applyHitlAction, deleteTask } from './tasks/state.js'
import { loadPipelineConfig } from '../../pipeline-editor/business/pipeline/index.js'
import { fetchGithubIssue } from './github/index.js'
import { getTaskChatState } from './taskChat.js'
import {
  loadArtifactActions,
  loadArtifactActionsFile,
  matchActions,
  matchByAttach,
  findAction,
  substitutePrompt,
  artifactBase,
  toActionView,
  saveArtifactActions,
} from './artifactActions/index.js'

export class MonitorBusiness extends AbstractBusiness {
  collectTasks() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return collectTasks(gate.root)
  }

  loadPipelineConfig(taskId: string | null) {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return loadPipelineConfig(gate.root, taskId)
  }

  flowProfilePath() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return { root: gate.root, path: flowProfilePath(gate.root) }
  }

  getTaskChatState(taskId: string) {
    return getTaskChatState(taskId)
  }

  fetchGithubIssue(url: string) {
    return fetchGithubIssue(url)
  }
}

export {
  collectTasks,
  flowProfilePath,
  createTask,
  readState,
  advanceStepOnJobSuccess,
  applyArchiveAction,
  applyHitlAction,
  deleteTask,
  loadPipelineConfig,
  fetchGithubIssue,
  getTaskChatState,
  loadArtifactActions,
  loadArtifactActionsFile,
  matchActions,
  matchByAttach,
  findAction,
  substitutePrompt,
  artifactBase,
  toActionView,
  saveArtifactActions,
}
