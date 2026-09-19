import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareMcpConfigForJob } from '../../../../../src/features/runner/business/providers/mcpJobConfig.js'
import { upsertMcpServer } from '../../../../../src/features/mcp/business/registry.js'
import type { McpStdioServer } from '../../../../../src/features/mcp/business/types.js'

/**
 * TC-44…TC-53 (+ TC-100) — `prepareMcpConfigForJob`.
 *
 * Bất biến số 1 của thiết kế: không Connection nào bật MCP ⇒ trả `null` và
 * 🚫 KHÔNG file nào chạm đĩa. Mọi ca ở đây đo bằng sự tồn tại thật của
 * `registryHome()/mcp-runtime/`, không qua giá trị trả về.
 */

const CANARY = 'sk-CANARY-do-not-log-0123456789'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function runtimeDir(): string {
  return path.join(home, 'mcp-runtime')
}

function runtimeFiles(): string[] {
  try {
    return fs.readdirSync(runtimeDir())
  } catch {
    return []
  }
}

function seed(over: Partial<McpStdioServer> & { id: string }) {
  upsertMcpServer({
    label: over.id,
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: [],
    env: {},
    ...over,
  })
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-job-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('prepareMcpConfigForJob — đường mặc định `null`', () => {
  // TC-44 — ⚠️ bất biến số 1 (E1)
  test('TC-44: `ids` rỗng / sai kiểu ⇒ null và 🚫 không tạo `mcp-runtime`', () => {
    seed({ id: 'on1' })
    const variants: unknown[] = [undefined, null, [], 'playwright', {}, [1, true, null]]
    for (const ids of variants) {
      expect(prepareMcpConfigForJob({ ids, workspace: '/ws', jobId: 'job-1' })).toBeNull()
    }
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  // TC-45 — E2
  test('TC-45: id trỏ server không tồn tại ⇒ null, không file nào được ghi', () => {
    expect(prepareMcpConfigForJob({ ids: ['da-bi-xoa'], workspace: '/ws', jobId: 'job-1' })).toBeNull()
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  // TC-46 — E2
  test('TC-46: id trỏ server đang tắt ⇒ null, không file nào được ghi', () => {
    seed({ id: 'off', enabled: false })
    expect(prepareMcpConfigForJob({ ids: ['off'], workspace: '/ws', jobId: 'job-1' })).toBeNull()
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })
})

describe('prepareMcpConfigForJob — sinh file', () => {
  // TC-47
  test('TC-47: hỗn hợp bật / tắt / không tồn tại ⇒ chỉ server bật vào file', () => {
    seed({ id: 'on1' })
    seed({ id: 'on2' })
    seed({ id: 'off', enabled: false })

    const handle = prepareMcpConfigForJob({
      ids: ['on1', 'off', 'khong-co', 'on2'],
      workspace: '/ws',
      jobId: 'job-1',
    })

    expect(handle).not.toBeNull()
    expect(handle!.count).toBe(2)
    expect(new Set(handle!.names)).toEqual(new Set(['on1', 'on2']))
    const json = JSON.parse(fs.readFileSync(handle!.path, 'utf8'))
    expect(Object.keys(json.mcpServers).sort()).toEqual(['on1', 'on2'])
  })

  // TC-48 — G7 / F: file nằm ngoài workspace người dùng.
  test('TC-48: file đúng chỗ, đúng quyền; 🚫 không nằm dưới workspace', () => {
    seed({ id: 'on1' })
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-ws-'))
    try {
      const handle = prepareMcpConfigForJob({ ids: ['on1'], workspace, jobId: 'job-1' })!
      const resolved = path.resolve(handle.path)

      expect(resolved.startsWith(path.resolve(runtimeDir()) + path.sep)).toBe(true)
      expect(resolved.startsWith(path.resolve(workspace) + path.sep)).toBe(false)
      expect(fs.existsSync(resolved)).toBe(true)
      expect(JSON.parse(fs.readFileSync(resolved, 'utf8')).mcpServers).toBeTruthy()

      // E6: win32 `chmod` gần như vô nghĩa — bỏ assert quyền, giữ assert vị trí.
      if (process.platform !== 'win32') {
        expect(fs.statSync(resolved).mode & 0o777).toBe(0o600)
        expect(fs.statSync(runtimeDir()).mode & 0o777).toBe(0o700)
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  // TC-49 — E4
  test('TC-49: `dispose()` xoá file và chịu được gọi lặp', () => {
    seed({ id: 'on1' })

    const a = prepareMcpConfigForJob({ ids: ['on1'], workspace: '/ws', jobId: 'job-a' })!
    a.dispose()
    expect(fs.existsSync(a.path)).toBe(false)
    expect(() => a.dispose()).not.toThrow()

    const b = prepareMcpConfigForJob({ ids: ['on1'], workspace: '/ws', jobId: 'job-b' })!
    fs.rmSync(b.path, { force: true })
    expect(() => b.dispose()).not.toThrow()
  })

  // TC-50
  test('TC-50: nội dung file 🚫 không mang tham chiếu `env:` chưa resolve', () => {
    delete process.env.BIEN_KHONG_TON_TAI
    seed({ id: 'on1', env: { TOKEN: 'env:BIEN_KHONG_TON_TAI' } })

    const handle = prepareMcpConfigForJob({ ids: ['on1'], workspace: '/ws', jobId: 'job-1' })!
    const raw = fs.readFileSync(handle.path, 'utf8')

    expect(raw).not.toContain('env:')
    expect(handle.warnings.length).toBeGreaterThanOrEqual(1)
  })

  // TC-51
  test('TC-51: `names` chỉ chứa id; `names` + `warnings` không mang canary', () => {
    seed({ id: 'on1', env: { TOKEN: CANARY } })

    const handle = prepareMcpConfigForJob({ ids: ['on1'], workspace: '/ws', jobId: 'job-1' })!

    expect(handle.names).toEqual(['on1'])
    expect([...handle.names, ...handle.warnings].join('\n')).not.toContain(CANARY)
    // Giá trị thật vẫn phải đi vào danh sách mask của caller.
    expect(handle.secrets).toContain(CANARY)
  })

  // TC-52 — path traversal
  test('TC-52: `jobId` bất thường ⇒ đường dẫn vẫn bị giam trong `mcp-runtime`', () => {
    seed({ id: 'on1' })
    const jobIds = ['../../etc/x', 'a/b', '', '..', 'j'.repeat(300)]

    for (const jobId of jobIds) {
      const handle = prepareMcpConfigForJob({ ids: ['on1'], workspace: '/ws', jobId })!
      const resolved = path.resolve(handle.path)
      expect(resolved.startsWith(path.resolve(runtimeDir()) + path.sep)).toBe(true)
    }

    // 🚫 Không file nào rơi ra ngoài thư mục runtime.
    for (const name of runtimeFiles()) {
      expect(path.dirname(path.resolve(runtimeDir(), name))).toBe(path.resolve(runtimeDir()))
    }
    expect(fs.existsSync(path.join(home, 'etc'))).toBe(false)
  })

  // TC-53 — E5
  test('TC-53: hai job song song ⇒ hai file riêng, dispose không đụng nhau', () => {
    seed({ id: 'on1' })

    const a = prepareMcpConfigForJob({ ids: ['on1'], workspace: '/ws', jobId: 'job-a' })!
    const b = prepareMcpConfigForJob({ ids: ['on1'], workspace: '/ws', jobId: 'job-b' })!

    expect(a.path).not.toBe(b.path)
    expect(fs.existsSync(a.path)).toBe(true)
    expect(fs.existsSync(b.path)).toBe(true)

    a.dispose()
    expect(fs.existsSync(a.path)).toBe(false)
    expect(fs.existsSync(b.path)).toBe(true)
  })
})

/**
 * TC-100 — kênh `onWarning` (reviewer vòng 3 đề nghị, chưa có trong test-spec).
 *
 * Vòng lặp log cũ nằm trong `if (mcpHandle)`, nên khi handle là `null` thì
 * warning bị nuốt sạch. Kênh mới phải báo được **kể cả** ở nhánh trả `null` —
 * đó mới là ca nguy hiểm: job chạy thiếu tool trong im lặng.
 */
describe('TC-100: prepareMcpConfigForJob — kênh onWarning', () => {
  test('TC-100 (a): rụng một phần ⇒ đúng 2 dòng cảnh báo, file vẫn sinh', () => {
    seed({ id: 'on' })
    seed({ id: 'off', enabled: false })

    const warnings: string[] = []
    const handle = prepareMcpConfigForJob({
      ids: ['on', 'off', 'ghost'],
      workspace: '/ws',
      jobId: 'job-1',
      onWarning: (m) => warnings.push(m),
    })

    expect(handle).not.toBeNull()
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatch(/^mcp off: không tìm thấy hoặc đang tắt/)
    expect(warnings[1]).toMatch(/^mcp ghost: không tìm thấy hoặc đang tắt/)
  })

  test('TC-100 (b): rụng HẾT ⇒ null, VẪN đủ dòng cảnh báo, 🚫 không file nào', () => {
    seed({ id: 'off', enabled: false })

    const warnings: string[] = []
    const handle = prepareMcpConfigForJob({
      ids: ['off', 'ghost'],
      workspace: '/ws',
      jobId: 'job-1',
      onWarning: (m) => warnings.push(m),
    })

    expect(handle).toBeNull()
    expect(warnings).toHaveLength(2)
    expect(warnings.join('\n')).toContain('mcp off:')
    expect(warnings.join('\n')).toContain('mcp ghost:')
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  test('TC-100 (c): ca âm — không bật MCP ⇒ 0 cảnh báo, 🚫 không file nào', () => {
    seed({ id: 'on' })

    const warnings: string[] = []
    const handle = prepareMcpConfigForJob({
      ids: undefined,
      workspace: '/ws',
      jobId: 'job-1',
      onWarning: (m) => warnings.push(m),
    })

    expect(handle).toBeNull()
    expect(warnings).toEqual([])
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  test('TC-100 (d): warning của serializer cũng đi qua cùng kênh', () => {
    delete process.env.BIEN_KHONG_TON_TAI
    seed({ id: 'on', env: { TOKEN: 'env:BIEN_KHONG_TON_TAI' } })

    const warnings: string[] = []
    const handle = prepareMcpConfigForJob({
      ids: ['on'],
      workspace: '/ws',
      jobId: 'job-1',
      onWarning: (m) => warnings.push(m),
    })

    expect(handle).not.toBeNull()
    expect(warnings.join('\n')).toContain('BIEN_KHONG_TON_TAI')
    // Cùng nội dung với `handle.warnings` — một nguồn, hai đường ra.
    expect(warnings).toEqual(handle!.warnings)
  })
})
