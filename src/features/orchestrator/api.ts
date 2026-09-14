/**
 * Feature `orchestrator` không sở hữu route nào — endpoint điều khiển
 * (`PUT /api/task-orchestrator`) nằm ở `monitor`, chủ sở hữu task state.
 *
 * File này tồn tại vì `registerFeatureRoutes` (`backend/apiServer.ts`) là điểm
 * nạp feature **duy nhất** của backend: nó quét `src/features/<name>/api.ts` và
 * import module đó. Không có file này thì vòng lặp điều phối không bao giờ được
 * nạp, và pipeline bật orchestrator sẽ đứng im sau bước đầu tiên.
 *
 * Module không export `registerRoutes` — `registerFeatureRoutes` lọc qua và
 * không đăng ký gì thêm.
 */
import './business/index.js'
