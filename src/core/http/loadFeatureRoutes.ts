import type { Hono } from 'hono'
import type { HonoEnv } from './types.js'

/**
 * Convention: mỗi feature có `src/features/<name>/api.ts` export:
 *   - `registerRoutes(app)` — chỉ map route → `bind(Controller, method)`
 *   - `routeOrder?: number` — số nhỏ chạy trước (mặc định 100)
 * Logic nằm ở `controller.ts` (extends AbstractController).
 *
 * Đăng ký qua **static import** (Vite/Node không dynamic-import được `.ts`).
 * Thêm feature API → thêm 1 dòng import + vào mảng FEATURE_APIS.
 *
 * Thứ tự quan trọng khi route chồng (vd runners `/api/jobs/:id` trước
 * logs `/api/jobs/:id/log`).
 */
export type FeatureApiModule = {
  registerRoutes?: (app: Hono<HonoEnv>) => void
  routeOrder?: number
}

import * as agentEditorApi from '../../features/agent-editor/api.js'
import * as logsApi from '../../features/logs/api.js'
import * as monitorApi from '../../features/monitor/api.js'
import * as nlChatApi from '../../features/nl-chat/api.js'
import * as pipelineEditorApi from '../../features/pipeline-editor/api.js'
import * as runnerApi from '../../features/runner/api.js'
import * as settingsApi from '../../features/settings/api.js'

const FEATURE_APIS: FeatureApiModule[] = [
  settingsApi,
  runnerApi,
  logsApi,
  monitorApi,
  pipelineEditorApi,
  agentEditorApi,
  nlChatApi,
]

export async function registerFeatureRoutes(app: Hono<HonoEnv>): Promise<void> {
  const loaded = FEATURE_APIS.filter(
    (m): m is FeatureApiModule & { registerRoutes: (app: Hono<HonoEnv>) => void } =>
      typeof m.registerRoutes === 'function',
  ).map((m) => ({
    order: typeof m.routeOrder === 'number' ? m.routeOrder : 100,
    register: m.registerRoutes,
  }))

  loaded.sort((a, b) => a.order - b.order)
  for (const item of loaded) item.register(app)
}
