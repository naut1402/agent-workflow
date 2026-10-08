/**
 * Entry MCP trỏ vào CHÍNH dashboard đang chạy, để job điều phối luôn có tool
 * `orchestrator_decide` thật mà không bắt người vận hành tự khai server trong
 * tab MCP.
 *
 * Đây là thứ biến "job có MCP không" từ một phỏng đoán về cấu hình người dùng
 * thành một sự kiện dashboard tự quyết: nếu định vị được `mcp/stdio.ts` thì gắn,
 * không thì thôi — và `resolveDecisionRoute` đọc đúng hàm này để chốt tuyến nên
 * prompt không bao giờ dạy agent gọi một tool không tồn tại.
 */
import { dirnameFromImportMeta, existsSync, resolvePath } from '../../../../backend/lib/fileHelper.js'
import type { McpStdioServer } from '../../../mcp/business/types.js'

/**
 * Khoá entry trong file `--mcp-config`. Trùng id một server người dùng đã khai
 * thì entry tự gắn THẮNG (serialiser ghi sau) — job điều phối phải chắc chắn
 * nói chuyện với dashboard này, không phải một server trùng tên.
 */
export const SELF_MCP_SERVER_ID = 'dev-team-dashboard'

/**
 * `providers` → `business` → `runner` → `features` → `src` → gốc app; `mcp/`
 * nằm cạnh `src/` cả trong repo lẫn trong image (xem `docker/Dockerfile`).
 */
function selfStdioEntrypoint(): string | null {
  const path = resolvePath(dirnameFromImportMeta(import.meta.url), '../../../../../mcp/stdio.ts')
  return existsSync(path) ? path : null
}

/** Có gắn được MCP của chính dashboard vào job không — 🚫 không ném, caller rơi về sentinel. */
export function canAttachSelfMcp(): boolean {
  try {
    return selfStdioEntrypoint() != null
  } catch {
    return false
  }
}

/**
 * Dựng entry stdio cho job điều phối. `null` khi không định vị được entrypoint
 * — đó là hành vi đúng (caller bỏ qua), 🚫 không phải lỗi phải ném.
 */
export function buildSelfMcpEntry(input: {
  orchestratorToken: string
  baseUrl: string
}): McpStdioServer | null {
  const entry = selfStdioEntrypoint()
  if (!entry) return null
  return {
    id: SELF_MCP_SERVER_ID,
    label: 'dev-team-dashboard (self)',
    enabled: true,
    transport: 'stdio',
    // Chính runtime đang chạy dashboard, 🚫 KHÔNG chuỗi 'bun': job có thể chạy
    // với PATH khác hẳn tiến trình dashboard.
    command: process.execPath,
    // `--mode=full` đi qua argv chứ không chỉ qua `env` bên dưới: `resolveMode`
    // đọc argv TRƯỚC env, nên mode không phụ thuộc vào việc CLI bên thứ ba có
    // thật sự để `env` của entry thắng env kế thừa hay không. Thiếu `full` thì
    // tool `orchestrator_decide` (access `write`) vắng khỏi `tools/list` và
    // tuyến mcp hỏng trong im lặng.
    args: [entry, '--mode=full'],
    // ⚠️ Giữ `env` ở mức TỐI THIỂU. `serialiseMcpServers` đẩy mọi giá trị env
    // của entry stdio qua `collectSecretValues` → `isMaskableSecret`, mà
    // heuristic đó chỉ là "dài ≥ 8 ký tự và không phải `env:NAME`" — nó 🚫
    // không phân biệt secret với đường dẫn. Mỗi khoá thêm vào đây là một chuỗi
    // bị `maskLog` thay bằng `***` ở MỌI dòng log của job điều phối.
    //
    // Vì vậy 🚫 KHÔNG khai `DEV_TEAM_ROOT` / `DEV_TEAM_DASHBOARD_HOME`: chúng
    // không bí mật, và tiến trình MCP là con của `claude` vốn là con của
    // dashboard nên kế thừa được qua `buildChildEnv` (`{...process.env}`).
    // Khai lại chỉ đổi lấy việc log nuốt mất đường dẫn thật.
    env: {
      // Lưới thứ hai cho mode, cạnh `--mode=full` trên argv. 4 ký tự ⇒ dưới
      // ngưỡng mask, không ảnh hưởng log.
      DEVTEAM_MCP_MODE: 'full',
      // Hai biến này ĐỔI TÊN so với biến của tiến trình cha nên không kế thừa
      // được, buộc phải khai. Token là secret thật — được gom vào danh sách
      // mask là đúng ý.
      DASHBOARD_ORCHESTRATOR_TOKEN: input.orchestratorToken,
      DASHBOARD_ORCHESTRATOR_BASE_URL: input.baseUrl,
    },
  }
}
