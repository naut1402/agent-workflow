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

// xem docs/architecture/code/runner.md §22
/** Claude Code: file cấu hình riêng cho từng job, đường dẫn đi vào argv (`--mcp-config`). */
export class ConfigFlagMcpDelivery extends FileMcpDelivery {
  readonly kind = 'config-file-flag' as const

  /** File riêng theo job ⇒ gắn thêm entry của chính dashboard mà không đụng cấu hình người dùng. */
  override get acceptsSelfServer(): boolean {
    return true
  }

  protected override extraServers(input: McpJobInput): McpServer[] {
    // xem docs/architecture/code/runner.md §17
    const selfEntry = SelfMcpServer.forJob(input.metadata)

    // xem docs/architecture/code/runner.md §22
    if (selfEntry && !(input.ids as { length?: unknown } | null | undefined)?.length) {
      input.onLog?.(
        '[runner] MCP: job điều phối tự gắn dev-team-dashboard ⇒ chạy với --strict-mcp-config, '
        + 'MCP server cấu hình sẵn trên máy KHÔNG được nạp cho lượt này\n',
      )
    }

    return selfEntry ? [selfEntry] : []
  }

  protected write(config: McpCliConfig, input: McpJobInput): McpConfigHandle {
    const dir = this.runtimeDir()
    mkdirSync(dir, { recursive: true })
    chmodSafe(dir, 0o700)
    const path = joinPath(dir, `job-${McpServer.sanitiseId(input.jobId) ?? 'unknown'}.json`)
    // xem docs/architecture/code/runner.md §22
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

  // xem docs/architecture/code/runner.md §22
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
