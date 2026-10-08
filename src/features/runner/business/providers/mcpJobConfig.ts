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
import type { McpServerConfig } from '../../../mcp/business/types.js'
import type { McpDelivery } from '../types.js'
import { getCredential, isDirectSecretType, resolveSecretRef } from '../credentials.js'

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
  const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string') : []
  const extras = input.extraServers ?? []
  // Bất biến: KHÔNG id nào VÀ không entry tự gắn nào ⇒ vẫn `null`, không file
  // nào chạm đĩa, argv CLI không đổi. Đây là đường mặc định của mọi job thường.
  if (!ids.length && !extras.length) return null

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

  // Ghi đè im lặng là thứ không ai truy ngược được từ log job. So trên khoá ĐÃ
  // sanitise vì file dedup theo khoá đó: id `dev team dashboard` sanitise về
  // đúng `dev-team-dashboard` và bị ghi đè thật, so id thô sẽ bỏ sót.
  const extraKeys = new Set(extras.map((s) => sanitiseMcpServerId(s.id)).filter(Boolean))
  for (const server of servers) {
    if (!extraKeys.has(sanitiseMcpServerId(server.id))) continue
    warn(`mcp ${server.id}: entry của người dùng bị entry tự gắn của dashboard ghi đè cho job điều phối`)
  }

  // Rụng hết thì vẫn `null` để giữ bất biến "không file nào chạm đĩa"; cảnh báo
  // đã đi ra qua `onWarning` ở trên nên không im lặng tuyệt đối.
  if (!servers.length && !extras.length) return null

  // `extras` sau `servers`: `serialiseMcpServers` ghi theo thứ tự nên trùng
  // khoá thì entry tự gắn thắng.
  const all = [...servers, ...extras]
  const serialised = serialiseMcpServers(all, {
    workspace: input.workspace,
    secretFor: (credentialId) => {
      const resolved = resolveSecretRef(getCredential(credentialId))
      if (!isDirectSecretType(resolved.type)) return null
      return (resolved as { value?: string | null }).value ?? null
    },
  })
  for (const message of serialised.warnings) warn(message)

  // Một tên cho mỗi entry THẬT trong file: id trùng nhau chỉ sinh một entry
  // (báo 2 là báo sai thứ job nhận được), và server có id sanitise ra `null`
  // không vào file nên không được đếm. Nhưng tên hiển thị vẫn là id NGƯỜI DÙNG
  // gõ, 🚫 không phải khoá đã sanitise — giữ nguyên hợp đồng dòng log cũ để
  // tên khớp với tab MCP. Khoá trùng ⇒ lấy id của server thắng (ghi sau).
  const idByKey = new Map<string, string>()
  for (const server of all) {
    const key = sanitiseMcpServerId(server.id)
    if (key) idByKey.set(key, server.id)
  }
  const names = Object.keys(serialised.json.mcpServers).map((key) => idByKey.get(key) ?? key)

  return { json: serialised.json, names, secrets: serialised.secrets, warnings }
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
  const path = joinPath(dir, `job-${sanitiseMcpServerId(input.jobId) ?? 'unknown'}.json`)
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
