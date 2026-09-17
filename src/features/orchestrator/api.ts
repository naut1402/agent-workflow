/**
 * Endpoint điều khiển (`PUT /api/task-orchestrator`) nằm ở `monitor`, chủ sở
 * hữu task state — feature này chỉ sở hữu route MCP-over-HTTP (`handleMcp`).
 *
 * File này còn tồn tại vì lý do khác: `registerFeatureRoutes`
 * (`backend/apiServer.ts`) là điểm nạp feature **duy nhất** của backend — nó
 * quét `src/features/<name>/api.ts` và import module đó. Không có file này thì
 * vòng lặp điều phối không bao giờ được nạp, và pipeline bật orchestrator sẽ
 * đứng im sau bước đầu tiên.
 */
import type { Hono } from 'hono'
import type { HonoEnv } from '../../backend/http/types.js'
import { bind } from '../../backend/http/AbstractController.js'
import { OrchestratorController } from './controller.js'
import './business/index.js'

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.all('/api/mcp/orchestrator', bind(OrchestratorController, 'handleMcp'))
}
