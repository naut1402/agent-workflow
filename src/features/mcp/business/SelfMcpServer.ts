/**
 * Entry MCP trỏ vào CHÍNH dashboard đang chạy, để job điều phối luôn có tool
 * `orchestrator_decide` thật mà không bắt người vận hành tự khai server trong
 * tab MCP.
 *
 * Đây là thứ biến "job có MCP không" từ một phỏng đoán về cấu hình người dùng
 * thành một sự kiện dashboard tự quyết: nếu định vị được `mcp/stdio.ts` thì gắn,
 * không thì thôi — và `resolveDecisionRoute` đọc đúng `canAttach()` để chốt tuyến
 * nên prompt không bao giờ dạy agent gọi một tool không tồn tại.
 *
 * Lớp này còn là HỢP ĐỒNG XUYÊN PROCESS: tên server, biến mode, cờ `--mode=full`
 * và hai biến token / base URL được đọc ở cả hai đầu — dashboard (ghi entry, bơm
 * env cho CLI) và tiến trình `mcp/stdio.ts` (`DashboardMcpServer`,
 * `OrchestratorTools`). Khai một chỗ thì hai đầu không thể lệch nhau.
 *
 * ⚠️ Tiến trình stdio nạp barrel `mcp` để đọc các hằng này ⇒ file này 🚫 không có
 * side effect lúc nạp (timer, I/O, import `runner`) — `docs/mcp/server.md` §8.1.
 */
import { dirnameFromImportMeta, existsSync, resolvePath } from '../../../backend/lib/fileHelper.js'
import type { McpStdioServer } from '../schemas/mcpServer.js'
import { StdioMcpServer } from './StdioMcpServer.js'

/** `metadata` của job — chỉ đọc các khoá điều phối. */
type JobMetadata = Record<string, unknown> | undefined

export class SelfMcpServer extends StdioMcpServer {
  /**
   * Khoá entry trong file cấu hình MCP của job, tên server của tiến trình stdio
   * và tên client khi dashboard gọi server khác. Trùng id một server người dùng
   * đã khai thì entry tự gắn THẮNG (ghi sau) — job điều phối phải chắc chắn nói
   * chuyện với dashboard này, không phải một server trùng tên.
   */
  static readonly SERVER_ID = 'dev-team-dashboard'
  /** Env chọn mode của tiến trình stdio (`readonly` | `full`). */
  static readonly MODE_ENV_VAR = 'DEVTEAM_MCP_MODE'
  /** Cờ argv bật mode `full` — `resolveMode` đọc argv TRƯỚC env. */
  static readonly MODE_FULL_ARG = '--mode=full'
  /** Token của lượt điều phối — tool `orchestrator_decide` gửi lại cho dashboard. */
  static readonly TOKEN_ENV = 'DASHBOARD_ORCHESTRATOR_TOKEN'
  /** Base URL của dashboard mà tool `orchestrator_decide` gọi về. */
  static readonly BASE_URL_ENV = 'DASHBOARD_ORCHESTRATOR_BASE_URL'

  /** Chỉ `forJob` dựng được — entry tự gắn 🚫 đọc từ đĩa hay từ API. */
  private constructor(config: McpStdioServer) {
    super(config)
  }

  protected rebuild(config: McpStdioServer): SelfMcpServer {
    return new SelfMcpServer(config)
  }

  /**
   * `business` → `mcp` → `features` → `src` → gốc app; `mcp/` nằm cạnh `src/`
   * cả trong repo lẫn trong image (xem `docker/Dockerfile`).
   */
  private static entrypoint(): string | null {
    const path = resolvePath(dirnameFromImportMeta(import.meta.url), '../../../../mcp/stdio.ts')
    return existsSync(path) ? path : null
  }

  /** Có gắn được MCP của chính dashboard vào job không — 🚫 không ném, caller rơi về sentinel. */
  static canAttach(): boolean {
    try {
      return SelfMcpServer.entrypoint() != null
    } catch {
      return false
    }
  }

  /**
   * Guard DUY NHẤT của "job này mang token điều phối": job điều phối, có token
   * và dashboard biết địa chỉ của chính nó. `childEnv` và `forJob` cùng đọc nó,
   * nên không bao giờ có job mang tool mà thiếu token của tool đó.
   */
  private static orchestratorEnv(metadata: JobMetadata): Record<string, string> | null {
    const baseUrl = process.env.DEV_TEAM_SELF_BASE_URL
    if (metadata?.orchestratorJob !== true || typeof metadata.orchestratorToken !== 'string' || !baseUrl) {
      return null
    }
    return {
      [SelfMcpServer.TOKEN_ENV]: metadata.orchestratorToken,
      [SelfMcpServer.BASE_URL_ENV]: baseUrl,
    }
  }

  /**
   * Env bơm vào tiến trình CLI của job điều phối. Tool Bash của agent (`curl`) và
   * tiến trình MCP con kế thừa từ đây. Job không đủ guard ⇒ `{}`.
   */
  static childEnv(metadata?: Record<string, unknown>): Record<string, string> {
    return SelfMcpServer.orchestratorEnv(metadata) ?? {}
  }

  /**
   * Entry stdio cho job điều phối đi tuyến `mcp`. `null` khi job không đủ guard
   * của `childEnv`, không đi tuyến `mcp`, hoặc không định vị được entrypoint —
   * đó là hành vi đúng (caller bỏ qua), 🚫 không phải lỗi phải ném.
   */
  static forJob(metadata?: Record<string, unknown>): SelfMcpServer | null {
    if (metadata?.orchestratorMcpRoute !== 'mcp') return null
    const orchestratorEnv = SelfMcpServer.orchestratorEnv(metadata)
    if (!orchestratorEnv) return null
    const entry = SelfMcpServer.entrypoint()
    if (!entry) return null
    return new SelfMcpServer({
      id: SelfMcpServer.SERVER_ID,
      label: `${SelfMcpServer.SERVER_ID} (self)`,
      enabled: true,
      lastCheck: null,
      transport: 'stdio',
      // Chính runtime đang chạy dashboard, 🚫 KHÔNG chuỗi 'bun': job có thể chạy
      // với PATH khác hẳn tiến trình dashboard.
      command: process.execPath,
      // `--mode=full` đi qua argv chứ không chỉ qua `env` bên dưới: `resolveMode`
      // đọc argv TRƯỚC env, nên mode không phụ thuộc vào việc CLI bên thứ ba có
      // thật sự để `env` của entry thắng env kế thừa hay không. Thiếu `full` thì
      // tool `orchestrator_decide` (access `write`) vắng khỏi `tools/list` và
      // tuyến mcp hỏng trong im lặng.
      args: [entry, SelfMcpServer.MODE_FULL_ARG],
      // ⚠️ Giữ `env` ở mức TỐI THIỂU. `McpServerSet.toCliConfig` đẩy mọi giá trị
      // env của entry stdio qua `secretValues()` → `SecretMasker.isMaskable`, mà
      // heuristic đó chỉ là "dài ≥ 8 ký tự và không phải `env:NAME`" — nó 🚫
      // không phân biệt secret với đường dẫn. Mỗi khoá thêm vào đây là một chuỗi
      // bị thay bằng `***` ở MỌI dòng log của job điều phối.
      //
      // Vì vậy 🚫 KHÔNG khai `DEV_TEAM_ROOT` / `DEV_TEAM_DASHBOARD_HOME`: chúng
      // không bí mật, và tiến trình MCP là con của CLI vốn là con của dashboard
      // nên kế thừa được qua env của CLI (`{...process.env}`). Khai lại chỉ đổi
      // lấy việc log nuốt mất đường dẫn thật.
      env: {
        // Lưới thứ hai cho mode, cạnh `--mode=full` trên argv. 4 ký tự ⇒ dưới
        // ngưỡng mask, không ảnh hưởng log.
        [SelfMcpServer.MODE_ENV_VAR]: 'full',
        // Hai biến này ĐỔI TÊN so với biến của tiến trình cha nên không kế thừa
        // được, buộc phải khai. Token là secret thật — được gom vào danh sách
        // mask là đúng ý.
        ...orchestratorEnv,
      },
    })
  }
}
