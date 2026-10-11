/**
 * Feature này chỉ sở hữu 3 route REST cho orchestrator gọi ngược vào server
 * giữa lượt (`status`/`output`/`decide`) — state task thuộc `monitor`.
 *
 * File bắt buộc phải tồn tại: `registerFeatureRoutes` quét
 * `src/features/<name>/api.ts` làm điểm nạp feature duy nhất, thiếu file này
 * vòng lặp điều phối không bao giờ được nạp.
 */
import type { Hono } from 'hono'
import type { HonoEnv } from '../../backend/http/types.js'
import { bind } from '../../backend/http/AbstractController.js'
import { SelfMcpServer } from '../mcp/business/index.js'
import { OrchestratorController } from './controller.js'
import './business/index.js'

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/orchestrator/status', bind(OrchestratorController, 'getStatus'))
  app.get('/api/orchestrator/output', bind(OrchestratorController, 'getOutput'))
  // Path decide là hợp đồng với tiến trình `mcp/` (tool `orchestrator_decide`) — đọc hằng, 🚫 literal.
  app.post(SelfMcpServer.DECIDE_PATH, bind(OrchestratorController, 'postDecide'))
}
