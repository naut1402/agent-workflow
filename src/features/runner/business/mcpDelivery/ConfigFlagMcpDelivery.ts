import {
  chmodSafe,
  joinPath,
  mkdirSync,
  readdirSync,
  rmSync,
  writeTextFileSync,
} from '../../../../backend/lib/fileHelper.js'
import { McpServer, SelfMcpServer, type McpCliConfig } from '../../../mcp/business/index.js'
import { FileMcpDelivery, type McpConfigHandle } from './FileMcpDelivery.js'
import type { McpJobInput } from './McpJobDelivery.js'

/**
 * Claude Code: file cấu hình riêng cho từng job, đường dẫn đi vào argv
 * (`--mcp-config <file> --strict-mcp-config` — `buildClaudeInvocation`).
 *
 * File đặt dưới `runtimeDir()` (`registryHome()/mcp-runtime/`), KHÔNG trong
 * workspace người dùng: nó chứa secret đã giải, và ở trong repo thì lọt
 * `git status` của chính agent. Quyền `0600` là rào chính trên POSIX; trên
 * win32 `chmod` gần như vô nghĩa nên vị trí file (thư mục hồ sơ người dùng) mới
 * là thứ bảo vệ.
 */
export class ConfigFlagMcpDelivery extends FileMcpDelivery {
  readonly kind = 'config-file-flag' as const

  /** File riêng theo job ⇒ gắn thêm entry của chính dashboard mà không đụng cấu hình người dùng. */
  // fallow-ignore-next-line unused-class-member -- gọi đa hình qua `RunnerProvider.mcpDelivery?.acceptsSelfServer` (`orchestrator/business/mcpRoute.ts`)
  override get acceptsSelfServer(): boolean {
    return true
  }

  protected override extraServers(input: McpJobInput): McpServer[] {
    // `forJob` dùng CHUNG guard với `SelfMcpServer.childEnv` (env bơm cho CLI ở
    // `buildChildEnv`): không bơm env ⇒ cũng không có entry, nên không bao giờ
    // có job mang tool mà thiếu token của nó.
    const selfEntry = SelfMcpServer.forJob(input.metadata)

    // `--mcp-config` kéo theo `--strict-mcp-config` (buildClaudeInvocation), nên
    // khi entry tự gắn là lý do DUY NHẤT sinh file, node điều phối mất mọi MCP
    // server khai sẵn ở `~/.claude.json` của máy. Phần lớn là nâng cấp, nhưng nó
    // im lặng và không tất định (chỉ xảy ra khi tuyến ra `mcp`) — phải có một
    // dòng để truy ngược.
    if (selfEntry && !(input.ids as { length?: unknown } | null | undefined)?.length) {
      input.onLog?.(
        '[runner] MCP: job điều phối tự gắn dev-team-dashboard ⇒ chạy với --strict-mcp-config, '
        + 'MCP server cấu hình sẵn trên máy KHÔNG được nạp cho lượt này\n',
      )
    }

    // Job thường ⇒ `[]` ⇒ mọi hành vi cũ nguyên vẹn, kể cả bất biến "không
    // khai server nào ⇒ trả null, không file nào chạm đĩa".
    return selfEntry ? [selfEntry] : []
  }

  protected write(config: McpCliConfig, input: McpJobInput): McpConfigHandle {
    const dir = this.runtimeDir()
    mkdirSync(dir, { recursive: true })
    chmodSafe(dir, 0o700)
    const path = joinPath(dir, `job-${McpServer.sanitiseId(input.jobId) ?? 'unknown'}.json`)
    // `mode` ngay lúc tạo, không chỉ `chmod` sau: chmod ở dòng kế tiếp vẫn để lại
    // một cửa sổ file 0644 chứa token đã giải. `chmodSafe` giữ lại làm lưới cho
    // trường hợp file đã tồn tại (writeFileSync giữ mode cũ khi ghi đè).
    writeTextFileSync(path, JSON.stringify(config.json, null, 2), { mode: 0o600 })
    chmodSafe(path, 0o600)

    return {
      kind: this.kind,
      path,
      count: config.names.length,
      names: config.names,
      masker: config.masker,
      warnings: config.warnings,
      dispose() {
        try {
          rmSync(path, { force: true })
        } catch {
          /* dọn hụt không được làm hỏng kết quả job */
        }
      },
    }
  }

  /**
   * `dispose()` chỉ chạy trong `finally` của job, nên dashboard bị kill -9 giữa
   * chừng là bỏ lại file token plaintext không ai dọn. Không job nào của tiến
   * trình mới dùng lại file của tiến trình cũ, nên xoá sạch lúc bootstrap là đúng
   * — không cần so mtime.
   */
  // fallow-ignore-next-line unused-class-member -- gọi đa hình qua `provider.mcpDelivery.cleanupOrphans()` (`cleanupOrphanedMcpDeliveries`, `registry.ts`)
  override cleanupOrphans(): void {
    const dir = this.runtimeDir()
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (!name.startsWith('job-') || !name.endsWith('.json')) continue
      try {
        rmSync(joinPath(dir, name), { force: true })
      } catch {
        /* dọn hụt không được chặn bootstrap */
      }
    }
  }
}
