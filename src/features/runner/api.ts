import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { RunnerController } from './controller.js'

/** Jobs `:id` trước logs `:id/log`. */
export const routeOrder = 50

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/runners', bind(RunnerController, 'listRunners'))
  app.post('/api/runners', bind(RunnerController, 'upsertRunner'))
  app.delete('/api/runners', bind(RunnerController, 'deleteRunner'))
  app.all('/api/runners', bind(RunnerController, 'runnersMethodNotAllowed'))

  app.post('/api/runners/default', bind(RunnerController, 'setDefaultRunner'))

  app.get('/api/connections/scan', bind(RunnerController, 'scanConnections'))
  app.post('/api/connections/models', bind(RunnerController, 'listAvailableModels'))
  app.get('/api/connections', bind(RunnerController, 'listConnections'))
  app.post('/api/connections', bind(RunnerController, 'upsertConnection'))
  app.delete('/api/connections', bind(RunnerController, 'deleteConnection'))
  app.all('/api/connections', bind(RunnerController, 'connectionsMethodNotAllowed'))

  app.get('/api/provider-configs', bind(RunnerController, 'listProviderConfigs'))
  app.post('/api/provider-configs', bind(RunnerController, 'upsertProviderConfig'))
  app.delete('/api/provider-configs', bind(RunnerController, 'deleteProviderConfig'))
  app.all('/api/provider-configs', bind(RunnerController, 'providerConfigsMethodNotAllowed'))

  app.get('/api/commands', bind(RunnerController, 'listCommands'))
  app.post('/api/commands', bind(RunnerController, 'upsertCommand'))
  app.delete('/api/commands', bind(RunnerController, 'deleteCommand'))
  app.all('/api/commands', bind(RunnerController, 'commandsMethodNotAllowed'))

  app.get('/api/credentials', bind(RunnerController, 'listCredentials'))
  app.post('/api/credentials', bind(RunnerController, 'upsertCredential'))
  app.delete('/api/credentials', bind(RunnerController, 'deleteCredential'))
  app.all('/api/credentials', bind(RunnerController, 'credentialsMethodNotAllowed'))

  app.get('/api/credentials/oauth/capabilities', bind(RunnerController, 'listOAuthCapabilities'))
  app.post('/api/credentials/oauth/start', bind(RunnerController, 'startOAuthConnect'))
  app.get('/api/credentials/oauth/callback', bind(RunnerController, 'oauthCallback'))
  app.post('/api/credentials/oauth/exchange', bind(RunnerController, 'exchangeOAuthCode'))
  app.get('/api/credentials/oauth/status', bind(RunnerController, 'oauthStatus'))

  app.get('/api/jobs', bind(RunnerController, 'listOrGetJobs'))
  app.post('/api/jobs', bind(RunnerController, 'submitJob'))
  app.all('/api/jobs', bind(RunnerController, 'jobsMethodNotAllowed'))

  app.post('/api/jobs/:id/cancel', bind(RunnerController, 'cancelJob'))
  app.get('/api/jobs/:id', bind(RunnerController, 'getJob'))
  app.get('/api/jobs/:id/proposal', bind(RunnerController, 'getProposal'))
  app.post('/api/jobs/:id/approve', bind(RunnerController, 'approveJob'))
  app.post('/api/jobs/:id/discard', bind(RunnerController, 'discardJob'))
  app.post('/api/jobs/:id/feedback', bind(RunnerController, 'jobFeedback'))
}
