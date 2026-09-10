import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { KnowledgeController } from './controller.js'

/** Khe trống giữa `pipeline-editor` (80) và `agent-editor` (90). */
export const routeOrder = 85

export function registerRoutes(app: Hono<HonoEnv>): void {
  // Hono match theo thứ tự đăng ký → route con phải đứng trước route gốc.
  app.get('/api/knowledge/tags', bind(KnowledgeController, 'listTags'))
  app.post('/api/knowledge/tags/rename', bind(KnowledgeController, 'renameTag'))
  app.get('/api/knowledge/bundle', bind(KnowledgeController, 'getBundle'))
  app.get('/api/knowledge/collections', bind(KnowledgeController, 'listCollections'))
  app.post('/api/knowledge/collections', bind(KnowledgeController, 'createCollection'))
  app.put('/api/knowledge/collections/:id', bind(KnowledgeController, 'updateCollection'))
  app.delete('/api/knowledge/collections/:id', bind(KnowledgeController, 'deleteCollection'))
  app.post('/api/knowledge/upload', bind(KnowledgeController, 'uploadEntry'))

  // `?id=` phân biệt read và list — id chứa `/` nên không tách thành path param.
  app.get('/api/knowledge', bind(KnowledgeController, 'listOrReadEntry'))
  app.post('/api/knowledge', bind(KnowledgeController, 'createEntry'))
  app.put('/api/knowledge', bind(KnowledgeController, 'updateEntry'))
  app.delete('/api/knowledge', bind(KnowledgeController, 'deleteEntry'))
  // 405 thay vì rơi xuống 404 cho method lạ — theo tiền lệ `runner/api.ts`.
  app.all('/api/knowledge', bind(KnowledgeController, 'entryMethodNotAllowed'))
}
