import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mcpRegistry } from '../../../../../../src/features/mcp/business/index.js'
import type { McpStdioServer } from '../../../../../../src/features/mcp/schemas/mcpServer.js'
import { ConfigFlagMcpDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/ConfigFlagMcpDelivery.js'
import type { McpJobInput } from '../../../../../../src/features/runner/business/mcpDelivery/McpJobDelivery.js'
import { RunnerCredentialResolver } from '../../../../../../src/features/runner/business/RunnerCredentialResolver.js'

/**
 * TC-44…TC-53 (+ TC-100) — `ConfigFlagMcpDelivery` (claude, `--mcp-config`).
 *
 * Bất biến số 1 của thiết kế: không Connection nào bật MCP ⇒ trả `null` và
 * 🚫 KHÔNG file nào chạm đĩa. Mọi ca ở đây đo bằng sự tồn tại thật của
 * `registryHome()/mcp-runtime/`, không qua giá trị trả về.
 */

const CANARY = 'sk-CANARY-do-not-log-0123456789'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const prevBaseUrl = process.env.DEV_TEAM_SELF_BASE_URL

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
  const res = mcpRegistry.upsert({
    label: over.id,
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: [],
    env: {},
    ...over,
  })
  expect(res.ok).toBe(true)
}

const delivery = new ConfigFlagMcpDelivery(runtimeDir, new RunnerCredentialResolver())

function prepare(input: Partial<McpJobInput> & { ids: unknown }) {
  return delivery.prepare({ workspace: '/ws', jobId: 'job-1', ...input })
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-job-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DEV_TEAM_SELF_BASE_URL
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  if (prevBaseUrl === undefined) delete process.env.DEV_TEAM_SELF_BASE_URL
  else process.env.DEV_TEAM_SELF_BASE_URL = prevBaseUrl
  fs.rmSync(home, { recursive: true, force: true })
})

describe('ConfigFlagMcpDelivery — khai báo', () => {
  test('kind `config-file-flag`, nhận được entry tự gắn (node điều phối)', () => {
    expect(delivery.kind).toBe('config-file-flag')
    expect(delivery.acceptsSelfServer).toBe(true)
  })
})

describe('ConfigFlagMcpDelivery — đường mặc định `null`', () => {
  // TC-44 — ⚠️ bất biến số 1 (E1)
  test('TC-44: `ids` rỗng / sai kiểu ⇒ null và 🚫 không tạo `mcp-runtime`', async () => {
    seed({ id: 'on1' })
    const variants: unknown[] = [undefined, null, [], 'playwright', {}, [1, true, null]]
    for (const ids of variants) {
      expect(await prepare({ ids })).toBeNull()
    }
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  // TC-45 — E2
  test('TC-45: id trỏ server không tồn tại ⇒ null, không file nào được ghi', async () => {
    expect(await prepare({ ids: ['da-bi-xoa'] })).toBeNull()
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  // TC-46 — E2
  test('TC-46: id trỏ server đang tắt ⇒ null, không file nào được ghi', async () => {
    seed({ id: 'off', enabled: false })
    expect(await prepare({ ids: ['off'] })).toBeNull()
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })
})

describe('ConfigFlagMcpDelivery — sinh file', () => {
  // TC-47
  test('TC-47: hỗn hợp bật / tắt / không tồn tại ⇒ chỉ server bật vào file', async () => {
    seed({ id: 'on1' })
    seed({ id: 'on2' })
    seed({ id: 'off', enabled: false })

    const handle = await prepare({ ids: ['on1', 'off', 'khong-co', 'on2'] })

    expect(handle).not.toBeNull()
    expect(handle!.kind).toBe('config-file-flag')
    expect(handle!.count).toBe(2)
    expect(new Set(handle!.names)).toEqual(new Set(['on1', 'on2']))
    const json = JSON.parse(fs.readFileSync(handle!.path, 'utf8'))
    expect(Object.keys(json.mcpServers).sort()).toEqual(['on1', 'on2'])
  })

  // TC-48 — G7 / F: file nằm ngoài workspace người dùng.
  test('TC-48: file đúng chỗ, đúng quyền; 🚫 không nằm dưới workspace', async () => {
    seed({ id: 'on1' })
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-ws-'))
    try {
      const handle = (await prepare({ ids: ['on1'], workspace }))!
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
  test('TC-49: `dispose()` xoá file và chịu được gọi lặp', async () => {
    seed({ id: 'on1' })

    const a = (await prepare({ ids: ['on1'], jobId: 'job-a' }))!
    a.dispose()
    expect(fs.existsSync(a.path)).toBe(false)
    expect(() => a.dispose()).not.toThrow()

    const b = (await prepare({ ids: ['on1'], jobId: 'job-b' }))!
    fs.rmSync(b.path, { force: true })
    expect(() => b.dispose()).not.toThrow()
  })

  // TC-50
  test('TC-50: nội dung file 🚫 không mang tham chiếu `env:` chưa resolve', async () => {
    delete process.env.BIEN_KHONG_TON_TAI
    seed({ id: 'on1', env: { TOKEN: 'env:BIEN_KHONG_TON_TAI' } })

    const handle = (await prepare({ ids: ['on1'] }))!
    const raw = fs.readFileSync(handle.path, 'utf8')

    expect(raw).not.toContain('env:')
    expect(handle.warnings.length).toBeGreaterThanOrEqual(1)
  })

  // TC-51
  test('TC-51: `names` chỉ chứa id; `names` + `warnings` không mang canary', async () => {
    seed({ id: 'on1', env: { TOKEN: CANARY } })

    const handle = (await prepare({ ids: ['on1'] }))!

    expect(handle.names).toEqual(['on1'])
    expect([...handle.names, ...handle.warnings].join('\n')).not.toContain(CANARY)
    // Giá trị thật vẫn phải đi vào bộ mask của caller.
    expect(handle.masker.values).toContain(CANARY)
    expect(handle.masker.mask(`x ${CANARY} y`)).toBe('x *** y')
  })

  // TC-52 — path traversal
  test('TC-52: `jobId` bất thường ⇒ đường dẫn vẫn bị giam trong `mcp-runtime`', async () => {
    seed({ id: 'on1' })
    const jobIds = ['../../etc/x', 'a/b', '', '..', 'j'.repeat(300)]

    for (const jobId of jobIds) {
      const handle = (await prepare({ ids: ['on1'], jobId }))!
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
  test('TC-53: hai job song song ⇒ hai file riêng, dispose không đụng nhau', async () => {
    seed({ id: 'on1' })

    const a = (await prepare({ ids: ['on1'], jobId: 'job-a' }))!
    const b = (await prepare({ ids: ['on1'], jobId: 'job-b' }))!

    expect(a.path).not.toBe(b.path)
    expect(fs.existsSync(a.path)).toBe(true)
    expect(fs.existsSync(b.path)).toBe(true)

    a.dispose()
    expect(fs.existsSync(a.path)).toBe(false)
    expect(fs.existsSync(b.path)).toBe(true)
  })
})

/**
 * TC-100 — kênh `onWarning`. Kênh phải báo được **kể cả** ở nhánh trả `null` —
 * đó mới là ca nguy hiểm: job chạy thiếu tool trong im lặng.
 */
describe('TC-100: ConfigFlagMcpDelivery — kênh onWarning', () => {
  test('TC-100 (a): rụng một phần ⇒ đúng 2 dòng cảnh báo, file vẫn sinh', async () => {
    seed({ id: 'on' })
    seed({ id: 'off', enabled: false })

    const warnings: string[] = []
    const handle = await prepare({ ids: ['on', 'off', 'ghost'], onWarning: (m) => warnings.push(m) })

    expect(handle).not.toBeNull()
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatch(/^mcp off: không tìm thấy hoặc đang tắt/)
    expect(warnings[1]).toMatch(/^mcp ghost: không tìm thấy hoặc đang tắt/)
  })

  test('TC-100 (b): rụng HẾT ⇒ null, VẪN đủ dòng cảnh báo, 🚫 không file nào', async () => {
    seed({ id: 'off', enabled: false })

    const warnings: string[] = []
    const handle = await prepare({ ids: ['off', 'ghost'], onWarning: (m) => warnings.push(m) })

    expect(handle).toBeNull()
    expect(warnings).toHaveLength(2)
    expect(warnings.join('\n')).toContain('mcp off:')
    expect(warnings.join('\n')).toContain('mcp ghost:')
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  test('TC-100 (c): ca âm — không bật MCP ⇒ 0 cảnh báo, 🚫 không file nào', async () => {
    seed({ id: 'on' })

    const warnings: string[] = []
    const handle = await prepare({ ids: undefined, onWarning: (m) => warnings.push(m) })

    expect(handle).toBeNull()
    expect(warnings).toEqual([])
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  test('TC-100 (d): warning của serializer cũng đi qua cùng kênh', async () => {
    delete process.env.BIEN_KHONG_TON_TAI
    seed({ id: 'on', env: { TOKEN: 'env:BIEN_KHONG_TON_TAI' } })

    const warnings: string[] = []
    const handle = await prepare({ ids: ['on'], onWarning: (m) => warnings.push(m) })

    expect(handle).not.toBeNull()
    expect(warnings.join('\n')).toContain('BIEN_KHONG_TON_TAI')
    // Cùng nội dung với `handle.warnings` — một nguồn, hai đường ra.
    expect(warnings).toEqual(handle!.warnings)
  })
})

/**
 * Entry tự gắn `dev-team-dashboard` của job điều phối — `extraServers`. Guard
 * phải trùng ĐÚNG bộ guard bơm token của `buildChildEnv`.
 */
describe('ConfigFlagMcpDelivery — entry tự gắn của node điều phối', () => {
  const ORCH = { orchestratorJob: true, orchestratorMcpRoute: 'mcp', orchestratorToken: 'tok-orch-0123456789' }

  test('đủ guard, 🚫 server người dùng ⇒ file chỉ có entry dashboard + dòng log --strict-mcp-config', async () => {
    process.env.DEV_TEAM_SELF_BASE_URL = 'http://127.0.0.1:5173'
    const logs: string[] = []

    const handle = await prepare({ ids: undefined, metadata: ORCH, onLog: (l) => logs.push(l) })

    expect(handle).not.toBeNull()
    expect(handle!.names).toEqual(['dev-team-dashboard'])
    const json = JSON.parse(fs.readFileSync(handle!.path, 'utf8'))
    expect(Object.keys(json.mcpServers)).toEqual(['dev-team-dashboard'])
    expect(json.mcpServers['dev-team-dashboard'].env.DASHBOARD_ORCHESTRATOR_TOKEN).toBe(ORCH.orchestratorToken)
    // Token là secret thật ⇒ nằm trong bộ mask của log job.
    expect(handle!.masker.values).toContain(ORCH.orchestratorToken)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('--strict-mcp-config')
    expect(logs[0].endsWith('\n')).toBe(true)
    handle!.dispose()
  })

  test('có server người dùng ⇒ 🚫 dòng log --strict-mcp-config, entry dashboard ghi SAU', async () => {
    process.env.DEV_TEAM_SELF_BASE_URL = 'http://127.0.0.1:5173'
    seed({ id: 'on1' })
    const logs: string[] = []

    const handle = (await prepare({ ids: ['on1'], metadata: ORCH, onLog: (l) => logs.push(l) }))!

    expect(handle.names).toEqual(['on1', 'dev-team-dashboard'])
    expect(logs).toEqual([])
    handle.dispose()
  })

  test('entry người dùng trùng khoá ⇒ cảnh báo ghi đè, entry dashboard thắng', async () => {
    process.env.DEV_TEAM_SELF_BASE_URL = 'http://127.0.0.1:5173'
    seed({ id: 'dev-team-dashboard', command: 'nguoi-dung' })
    const warnings: string[] = []

    const handle = (await prepare({
      ids: ['dev-team-dashboard'],
      metadata: ORCH,
      onWarning: (m) => warnings.push(m),
    }))!

    expect(warnings.join('\n')).toContain('bị entry tự gắn của dashboard ghi đè')
    const json = JSON.parse(fs.readFileSync(handle.path, 'utf8'))
    expect(json.mcpServers['dev-team-dashboard'].command).not.toBe('nguoi-dung')
    handle.dispose()
  })

  test('thiếu một guard bất kỳ ⇒ 🚫 tự gắn, giữ bất biến `null`', async () => {
    const cases: [Record<string, unknown>, string | undefined][] = [
      [{ ...ORCH, orchestratorJob: false }, 'http://127.0.0.1:5173'],
      [{ ...ORCH, orchestratorMcpRoute: 'sentinel' }, 'http://127.0.0.1:5173'],
      [{ ...ORCH, orchestratorToken: 42 }, 'http://127.0.0.1:5173'],
      [ORCH, undefined],
    ]
    for (const [metadata, baseUrl] of cases) {
      if (baseUrl) process.env.DEV_TEAM_SELF_BASE_URL = baseUrl
      else delete process.env.DEV_TEAM_SELF_BASE_URL
      const logs: string[] = []
      expect(await prepare({ ids: undefined, metadata, onLog: (l) => logs.push(l) })).toBeNull()
      expect(logs).toEqual([])
    }
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })
})

describe('ConfigFlagMcpDelivery — cleanupOrphans', () => {
  test('xoá mọi `job-*.json` bỏ lại, 🚫 đụng file khác trong `mcp-runtime`', async () => {
    seed({ id: 'on1' })
    const a = (await prepare({ ids: ['on1'], jobId: 'job-a' }))!
    const b = (await prepare({ ids: ['on1'], jobId: 'job-b' }))!
    fs.writeFileSync(path.join(runtimeDir(), 'cursor-workspaces.json'), '{"entries":[]}', 'utf8')

    delivery.cleanupOrphans()

    expect(fs.existsSync(a.path)).toBe(false)
    expect(fs.existsSync(b.path)).toBe(false)
    expect(runtimeFiles()).toEqual(['cursor-workspaces.json'])
  })

  test('🚫 có `mcp-runtime` ⇒ 🚫 ném', () => {
    expect(fs.existsSync(runtimeDir())).toBe(false)
    expect(() => delivery.cleanupOrphans()).not.toThrow()
  })
})

/* ─── TC-E06 · TC-C13 — từ file store tới file config của job ─── */

/**
 * TC-E06 là **ca chốt rủi ro hồi quy im lặng**: file `mcp-servers.json` còn ở v1
 * với `timeoutMs: 15000` (mặc định CŨ) mà đi thẳng xuống `startupTimeoutSec: 15`
 * là rút thời gian khởi động của job từ 120s xuống 15s.
 *
 * Đo ở đây chứ 🚫 không ở test registry: chỉ khi ghép ĐỌC STORE + SINH FILE mới
 * thấy hậu quả thật sự tới được job.
 */
describe('TC-E06 / TC-C13: store v1 → file config cho job', () => {
  function writeV1Store(servers: Record<string, unknown>[]) {
    fs.writeFileSync(
      path.join(home, 'mcp-servers.json'),
      JSON.stringify({ version: 1, servers }),
      'utf8',
    )
  }

  const V1_STDIO = {
    id: 'on1',
    label: 'on1',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: [],
    env: {},
  }

  test('TC-E06: v1 với `timeoutMs: 15000` ⇒ entry 🚫 KHÔNG có khoá timeout khởi động (job dùng mặc định CLI)', async () => {
    writeV1Store([{ ...V1_STDIO, timeoutMs: 15_000 }])

    const handle = (await prepare({ ids: ['on1'] }))!
    const entry = JSON.parse(fs.readFileSync(handle.path, 'utf8')).mcpServers.on1

    expect(entry).not.toHaveProperty('startupTimeoutSec')
    expect(Object.keys(entry)).toEqual(['type', 'command', 'args', 'env'])
    // 🚫 Không con số 15 nào lọt xuống file dưới bất kỳ khoá nào.
    expect(JSON.stringify(entry)).not.toContain('15')
    expect(handle.warnings).toEqual([])
  })

  test('TC-E06 (đối chứng): giá trị v1 ≥ mặc định mới được giữ và ĐI XUỐNG file', async () => {
    writeV1Store([{ ...V1_STDIO, timeoutMs: 300_000 }])

    const handle = (await prepare({ ids: ['on1'] }))!
    const entry = JSON.parse(fs.readFileSync(handle.path, 'utf8')).mcpServers.on1

    expect(entry.startupTimeoutSec).toBe(300)
  })

  test('TC-C13: file config mang khoá timeout vẫn là JSON hợp lệ, quyền 0600', async () => {
    seed({ id: 'on1', timeoutMs: 120_000 })

    const handle = (await prepare({ ids: ['on1'] }))!
    const raw = fs.readFileSync(handle.path, 'utf8')

    expect(() => JSON.parse(raw)).not.toThrow()
    expect(JSON.parse(raw).mcpServers.on1.startupTimeoutSec).toBe(120)
    if (process.platform !== 'win32') {
      expect(fs.statSync(handle.path).mode & 0o777).toBe(0o600)
    }
  })
})
