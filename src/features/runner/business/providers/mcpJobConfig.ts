import {
  chmodSync,
  joinPath,
  mkdirSync,
  readdirSync,
  rmSync,
  writeTextFileSync,
} from '../../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../../backend/registry.js'
import {
  McpRegistry,
  McpServer,
  mcpRegistry,
  type CredentialResolver,
  type McpCliConfig,
  type McpServerConfig,
  type McpServerSet,
} from '../../../mcp/business/index.js'
import type { McpDelivery } from '../types.js'
import { getCredential, isDirectSecretType, resolveSecretRef } from '../credentials.js'

/** Credential của server từ xa — giải qua vault + `credentials.json` của `runner`. */
const runnerCredentials: CredentialResolver = {
  secretFor(credentialId) {
    const resolved = resolveSecretRef(getCredential(credentialId))
    if (!isDirectSecretType(resolved.type)) return null
    return (resolved as { value?: string | null }).value ?? null
  },
}

export interface McpJobConfigHandle {
  /**
   * Cách file đến được CLI. `config-file-flag` ⇒ đường dẫn đi vào argv
   * (`--mcp-config`); `workspace-config-file` ⇒ CLI tự đọc theo cwd và đường dẫn
   * 🚫 KHÔNG được lọt vào argv. Caller phân biệt bằng field này, không đoán theo
   * hình dạng `path`.
   */
  kind: Extract<McpDelivery, 'config-file-flag' | 'workspace-config-file'>
  path: string
  count: number
  /** Id server — an toàn để log; không bao giờ là giá trị env/header. */
  names: string[]
  /** Giá trị đã giải, để caller mask trước khi ghi stdout/stderr con vào log job. */
  secrets: string[]
  warnings: string[]
  dispose(): void
}

export interface PrepareMcpConfigInput {
  ids: unknown
  workspace: string
  jobId: string
  /**
   * Server do dashboard TỰ gắn, không nằm trong registry MCP của người dùng
   * (hiện chỉ có job điều phối dùng). Ghi SAU `ids` nên trùng khoá thì entry
   * này thắng — job điều phối phải chắc chắn nói chuyện với dashboard này.
   */
  extraServers?: McpServerConfig[]
  /**
   * Nhận cảnh báo ngay khi phát sinh, kể cả khi hàm trả `null`. Id bị tắt/xoá
   * sau khi Connection đã chọn thì không còn handle nào để mang `warnings` ra,
   * mà job chạy thiếu tool trong im lặng là thứ không ai truy ngược được.
   */
  onWarning?: (message: string) => void
}

export interface ResolvedJobMcp {
  json: { mcpServers: Record<string, unknown> }
  names: string[]
  secrets: string[]
  warnings: string[]
}

/**
 * Phần CHUNG của mọi cách giao cấu hình MCP cho job: lọc server đang bật, cảnh
 * báo id rụng, serialise ra JSON. Chưa chạm đĩa một byte nào.
 *
 * Tách ra để nhánh cursor (`cursorMcpWorkspace.ts`) dùng lại NGUYÊN VẸN thay vì
 * chép — kể cả bất biến `null`: không `ids` VÀ không `extras` ⇒ `null`, nên cả
 * hai nhánh cùng hưởng "không bật MCP ⇒ argv không đổi, không file nào chạm đĩa".
 */
export function resolveJobMcpServers(input: PrepareMcpConfigInput): ResolvedJobMcp | null {
  // Entry tự gắn đi qua cùng cổng chuẩn hoá với bản ghi registry — chỗ lắp ráp
  // duy nhất biết hiện thực `McpServer`.
  const extras = (input.extraServers ?? [])
    .map((config) => McpRegistry.normalise(config))
    .filter((server): server is McpServer => server !== null)
  // Bất biến `null` (không `ids` VÀ không `extras`), cảnh báo id rụng và cảnh báo
  // entry tự gắn đè entry người dùng đều nằm ở `select`.
  const set: McpServerSet | null = mcpRegistry.select({ ids: input.ids, extras, onWarning: input.onWarning })
  if (!set) return null

  // `extras` đứng sau `servers` trong bộ: `toCliConfig` ghi theo thứ tự nên trùng
  // khoá thì entry tự gắn thắng.
  const config: McpCliConfig = set.toCliConfig({ workspace: input.workspace, credentials: runnerCredentials }, input.onWarning)
  return {
    json: config.json,
    names: config.names,
    secrets: [...config.masker.values],
    warnings: config.warnings,
  }
}

/**
 * Sinh file cấu hình `mcpServers` cho một job, hoặc `null` khi job không dùng
 * MCP — `null` là đường mặc định và phải giữ nguyên: không Connection nào bật
 * MCP thì argv của CLI không đổi và không file nào chạm đĩa.
 *
 * File đặt dưới `registryHome()/mcp-runtime/`, KHÔNG trong workspace người dùng:
 * nó chứa secret đã giải, và ở trong repo thì lọt `git status` của chính agent.
 * Quyền `0600` là rào chính trên POSIX; trên win32 `chmod` gần như vô nghĩa nên
 * vị trí file (thư mục hồ sơ người dùng) mới là thứ bảo vệ.
 */
export function prepareMcpConfigForJob(input: PrepareMcpConfigInput): McpJobConfigHandle | null {
  const resolved = resolveJobMcpServers(input)
  if (!resolved) return null

  const dir = mcpRuntimeDir()
  mkdirSync(dir, { recursive: true })
  tryChmod(dir, 0o700)
  const path = joinPath(dir, `job-${McpServer.sanitiseId(input.jobId) ?? 'unknown'}.json`)
  // `mode` ngay lúc tạo, không chỉ `chmod` sau: chmod ở dòng kế tiếp vẫn để lại
  // một cửa sổ file 0644 chứa token đã giải. `tryChmod` giữ lại làm lưới cho
  // trường hợp file đã tồn tại (writeFileSync giữ mode cũ khi ghi đè).
  writeTextFileSync(path, JSON.stringify(resolved.json, null, 2), { mode: 0o600 })
  tryChmod(path, 0o600)

  return {
    kind: 'config-file-flag',
    path,
    count: resolved.names.length,
    names: resolved.names,
    secrets: resolved.secrets,
    warnings: resolved.warnings,
    dispose() {
      try {
        rmSync(path, { force: true })
      } catch {
        /* dọn hụt không được làm hỏng kết quả job */
      }
    },
  }
}

function mcpRuntimeDir(): string {
  return joinPath(registryHome(), 'mcp-runtime')
}

/**
 * `dispose()` chỉ chạy trong `finally` của job, nên dashboard bị kill -9 giữa
 * chừng là bỏ lại file token plaintext không ai dọn. Không job nào của tiến
 * trình mới dùng lại file của tiến trình cũ, nên xoá sạch lúc bootstrap là đúng
 * — không cần so mtime.
 */
export function cleanupOrphanedMcpConfigs(): void {
  const dir = mcpRuntimeDir()
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

export function tryChmod(target: string, mode: number): void {
  try {
    chmodSync(target, mode)
  } catch {
    /* filesystem không hỗ trợ (win32, bind mount) */
  }
}
