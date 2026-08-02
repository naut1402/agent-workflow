import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { AgentEditorController } from './controller.js'

export const routeOrder = 90

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/custom-agents', bind(AgentEditorController, 'listOrGetCustomAgents'))
  app.post('/api/custom-agents', bind(AgentEditorController, 'createCustomAgent'))
  app.delete('/api/custom-agents', bind(AgentEditorController, 'deleteCustomAgent'))
  app.post('/api/custom-agents/export', bind(AgentEditorController, 'exportCustomAgents'))
  app.post('/api/custom-agents/generate', bind(AgentEditorController, 'generateCustomAgent'))
  app.get('/api/agent-templates', bind(AgentEditorController, 'listAgentTemplates'))
  app.post('/api/agent-templates', bind(AgentEditorController, 'saveAgentTemplate'))
  app.delete('/api/agent-templates', bind(AgentEditorController, 'deleteAgentTemplate'))
  app.get('/api/workflow-step-templates', bind(AgentEditorController, 'listWorkflowStepTemplates'))
  app.post('/api/workflow-step-templates', bind(AgentEditorController, 'saveWorkflowStepTemplate'))
  app.delete('/api/workflow-step-templates', bind(AgentEditorController, 'deleteWorkflowStepTemplate'))
}
