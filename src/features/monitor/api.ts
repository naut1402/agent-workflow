import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { MonitorController } from './controller.js'

export const routeOrder = 70

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/projects', bind(MonitorController, 'getProjects'))
  app.post('/api/projects', bind(MonitorController, 'createProject'))
  app.patch('/api/projects/branch', bind(MonitorController, 'updateProjectBranch'))
  app.delete('/api/projects', bind(MonitorController, 'deleteProject'))
  app.all('/api/projects', bind(MonitorController, 'projectsMethodNotAllowed'))

  app.get('/api/tasks', bind(MonitorController, 'listTasks'))
  app.get('/api/pipeline-config', bind(MonitorController, 'getPipelineConfig'))
  app.get('/api/artifact', bind(MonitorController, 'getArtifact'))
  app.put('/api/artifact', bind(MonitorController, 'putArtifact'))
  app.get('/api/profile', bind(MonitorController, 'getProfile'))
  app.post('/api/profile', bind(MonitorController, 'postProfile'))
  app.get('/api/pipeline-export', bind(MonitorController, 'getPipelineExport'))
  app.get('/api/flow-profile', bind(MonitorController, 'getFlowProfile'))
  app.post('/api/flow-profile', bind(MonitorController, 'postFlowProfile'))
  app.put('/api/task-state', bind(MonitorController, 'putTaskState'))
  app.put('/api/task-archive', bind(MonitorController, 'putTaskArchive'))
  app.get('/api/artifact-actions', bind(MonitorController, 'getArtifactActions'))
  app.put('/api/artifact-actions', bind(MonitorController, 'putArtifactActions'))
  app.post('/api/artifact-actions/run', bind(MonitorController, 'runArtifactAction'))
  app.post('/api/tasks', bind(MonitorController, 'createTask'))
  app.delete('/api/tasks/:id', bind(MonitorController, 'deleteTask'))
  app.post('/api/tasks/:id/repair-state', bind(MonitorController, 'repairTaskState'))
  app.post('/api/tasks/:id/close-session', bind(MonitorController, 'closeTaskChatSession'))
  app.post('/api/tasks/:id/run-step', bind(MonitorController, 'runTaskStep'))
  app.post('/api/tasks/:id/reset-step', bind(MonitorController, 'resetTaskStep'))
  app.post('/api/tasks/:id/feedback', bind(MonitorController, 'postTaskFeedback'))
  app.get('/api/tasks/:id/chat', bind(MonitorController, 'getTaskChat'))
  app.post('/api/github/issue', bind(MonitorController, 'postGithubIssue'))
}
