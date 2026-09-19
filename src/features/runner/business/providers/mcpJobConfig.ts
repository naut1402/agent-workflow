import {
  chmodSync,
  joinPath,
  mkdirSync,
  readdirSync,
  rmSync,
  writeTextFileSync,
} from '../../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../../backend/registry.js'
import { listMcpServers, sanitiseMcpServerId, serialiseMcpServers } from '../../../mcp/business/index.js'
import { getCredential, isDirectSecretType, resolveSecretRef } from '../credentials.js'

export interface McpJobConfigHandle {
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
   * Nhận cảnh báo ngay khi phát sinh, kể cả khi hàm trả `null`. Id bị tắt/xoá
   * sau khi Connection đã chọn thì không còn handle nào để mang `warnings` ra,
   * mà job chạy thiếu tool trong im lặng là thứ không ai truy ngược được.
   */
  onWarning?: (message: string) => void
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
  const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string') : []
  if (!ids.length) return null

  const warnings: string[] = []
  const warn = (message: string) => {
    warnings.push(message)
    input.onWarning?.(message)
  }

  const servers = listMcpServers().filter((s) => ids.includes(s.id) && s.enabled)
  const resolvedIds = new Set(servers.map((s) => s.id))
  for (const id of ids) {
    if (resolvedIds.has(id)) continue
    warn(`mcp ${id}: không tìm thấy hoặc đang tắt — job chạy không có server này`)
  }

  // Rụng hết thì vẫn `null` để giữ bất biến "không file nào chạm đĩa"; cảnh báo
  // đã đi ra qua `onWarning` ở trên nên không im lặng tuyệt đối.
  if (!servers.length) return null

  const serialised = serialiseMcpServers(servers, {
    workspace: input.workspace,
    secretFor: (credentialId) => {
      const resolved = resolveSecretRef(getCredential(credentialId))
      if (!isDirectSecretType(resolved.type)) return null
      return (resolved as { value?: string | null }).value ?? null
    },
  })
  for (const message of serialised.warnings) warn(message)

  const dir = mcpRuntimeDir()
  mkdirSync(dir, { recursive: true })
  tryChmod(dir, 0o700)
  const path = joinPath(dir, `job-${sanitiseMcpServerId(input.jobId) ?? 'unknown'}.json`)
  // `mode` ngay lúc tạo, không chỉ `chmod` sau: chmod ở dòng kế tiếp vẫn để lại
  // một cửa sổ file 0644 chứa token đã giải. `tryChmod` giữ lại làm lưới cho
  // trường hợp file đã tồn tại (writeFileSync giữ mode cũ khi ghi đè).
  writeTextFileSync(path, JSON.stringify(serialised.json, null, 2), { mode: 0o600 })
  tryChmod(path, 0o600)

  return {
    path,
    count: servers.length,
    names: servers.map((s) => s.id),
    secrets: serialised.secrets,
    warnings,
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

function tryChmod(target: string, mode: number): void {
  try {
    chmodSync(target, mode)
  } catch {
    /* filesystem không hỗ trợ (win32, bind mount) */
  }
}
