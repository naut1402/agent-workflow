import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { PipelineEditorController } from './controller.js'

export const routeOrder = 80

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/pipeline-profiles', bind(PipelineEditorController, 'getPipelineProfiles'))
  app.post('/api/pipeline-profiles', bind(PipelineEditorController, 'createPipelineProfile'))
  app.delete('/api/pipeline-profiles', bind(PipelineEditorController, 'deletePipelineProfile'))
  app.post('/api/pipeline-config-write', bind(PipelineEditorController, 'writePipelineConfig'))
  app.get('/api/catalog', bind(PipelineEditorController, 'getCatalog'))
  app.get('/api/catalog-agent', bind(PipelineEditorController, 'getCatalogAgent'))
  app.get('/api/rules', bind(PipelineEditorController, 'getRules'))
}
