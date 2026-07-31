import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { SettingsController } from './controller.js'

/** Registry / fs / autoscan / github-tokens — trước runner & logs. */
export const routeOrder = 10

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/projects', bind(SettingsController, 'getProjects'))
  app.post('/api/projects', bind(SettingsController, 'createProject'))
  app.delete('/api/projects', bind(SettingsController, 'deleteProject'))
  app.all('/api/projects', bind(SettingsController, 'projectsMethodNotAllowed'))

  app.get('/api/fs/browse', bind(SettingsController, 'browseFs'))

  app.get('/api/autoscan', bind(SettingsController, 'getAutoscan'))
  app.put('/api/autoscan', bind(SettingsController, 'updateAutoscan'))
  app.post('/api/autoscan/run', bind(SettingsController, 'runAutoscan'))

  app.get('/api/github/tokens', bind(SettingsController, 'getGithubTokens'))
  app.put('/api/github/tokens', bind(SettingsController, 'updateGithubTokens'))
}
