import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { McpRegistry, mcpRegistry } from '../../../../../../src/features/mcp/business/index.js'
import type { McpServer } from '../../../../../../src/features/mcp/business/index.js'
import type { McpStdioServer } from '../../../../../../src/features/mcp/schemas/mcpServer.js'
import { ConfigFlagMcpDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/ConfigFlagMcpDelivery.js'
import type { McpJobInput } from '../../../../../../src/features/runner/business/mcpDelivery/McpJobDelivery.js'
import { WorkspaceFileMcpDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/WorkspaceFileMcpDelivery.js'
import { RunnerCredentialResolver } from '../../../../../../src/features/runner/business/RunnerCredentialResolver.js'

/**
 * TC-P5-03 … TC-P5-17 · TC-P5-23 · TC-P5-24 + 6 TC do review đề xuất
 * (TC-P5-CONC · TC-P5-OVERWRITE · TC-P5-LOCKORPHAN · TC-P5-STUCK-IDEMPOTENT ·
 * TC-P5-STUCK-RECOVER · TC-P5-STUCK-NOBLOCK · TC-P5-TEMPENTRY) —
 * `WorkspaceFileMcpDelivery` (cursor, `<workspace>/.cursor/mcp.json`).
 *
 * Bề mặt: **trạng thái trên đĩa** của workspace người dùng (`.cursor/`), ledger
 * ở `registryHome()/mcp-runtime/cursor-workspaces.json`, và `git status` thật
 * của một repo git thật. 🚫 Không mock filesystem: thứ phải chứng minh là "file
 * secret có nằm lại trong repo người dùng không", mà một fs giả 🚫 trả lời được.
 */

const CANARY = 'sk-test-LEAKCANARY-0123456789'

let home: string
let workspace: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function ledgerPath(): string {
  return path.join(home, 'mcp-runtime', 'cursor-workspaces.json')
}
function ledger(): any[] {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(), 'utf8')).entries ?? []
  } catch {
    return []
  }
}
function cursorDir(ws = workspace): string {
  return path.join(ws, '.cursor')
}
function configPath(ws = workspace): string {
  return path.join(cursorDir(ws), 'mcp.json')
}
function cursorFiles(ws = workspace): string[] {
  try {
    return fs.readdirSync(cursorDir(ws)).sort()
  } catch {
    return []
  }
}
/** Mọi file dưới workspace còn chứa canary — vế phủ định của mọi ca dọn dẹp. */
function filesWithCanary(dir = workspace): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === '.git') continue
        walk(full)
        continue
      }
      try {
        if (fs.readFileSync(full, 'utf8').includes(CANARY)) out.push(full)
      } catch {
        /* file nhị phân / đã biến mất giữa chừng */
      }
    }
  }
  walk(dir)
  return out
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

const runtimeDir = () => path.join(home, 'mcp-runtime')
const credentials = new RunnerCredentialResolver()
const delivery = new WorkspaceFileMcpDelivery(runtimeDir, credentials)

function prepare(over: Partial<McpJobInput> = {}) {
  return delivery.prepare({
    ids: ['on1'],
    workspace,
    jobId: 'job-cursor-1',
    ...over,
  })
}

/** Lưới cuối lúc bootstrap — cùng đường `cleanupOrphanedMcpDeliveries` gọi. */
function cleanupOrphans() {
  delivery.cleanupOrphans()
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cursor-home-'))
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cursor-ws-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(workspace, { recursive: true, force: true })
})

describe('WorkspaceFileMcpDelivery — bất biến "không bật MCP ⇒ 🚫 chạm đĩa"', () => {
  test('kind `workspace-config-file`, 🚫 nhận entry tự gắn (node điều phối)', () => {
    expect(delivery.kind).toBe('workspace-config-file')
    expect(delivery.acceptsSelfServer).toBe(false)
  })

  /**
   * TC-P5-03 ⭐ — 🚫 `ids` **và** 🚫 `extras` (cursor 🚫 tự gắn entry
   * `dev-team-dashboard` — chỉ claude có `acceptsSelfServer`).
   */
  test('TC-P5-03: 🚫 server nào bật, 🚫 extras ⇒ null, `.cursor` 🚫 tồn tại', async () => {
    seed({ id: 'on1' })
    for (const ids of [undefined, null, [], 'khong-phai-mang', {}, [1, true, null]]) {
      expect(await prepare({ ids, jobId: 'job-x' })).toBeNull()
    }
    expect(await prepare({ ids: ['da-bi-xoa'], jobId: 'job-x' })).toBeNull()
    // Job điều phối đủ guard vẫn 🚫 tự gắn gì ở cursor ⇒ vẫn `null`.
    expect(
      await prepare({
        ids: [],
        jobId: 'job-x',
        metadata: { orchestratorJob: true, orchestratorMcpRoute: 'mcp', orchestratorToken: 'tok-0123456789' },
      }),
    ).toBeNull()

    expect(fs.existsSync(cursorDir())).toBe(false)
    expect(fs.readdirSync(workspace)).toEqual([])
    expect(ledger()).toEqual([])
  })

  /**
   * TC-P5-04 — ca đối chứng: TC-P5-03 🚫 được hiểu nhầm thành "cách giao bằng
   * workspace 🚫 bao giờ ghi file khi 🚫 `ids`". Template `prepare` mang extras
   * xuống `attach` như mọi cách giao khác ⇒ file CÓ được ghi.
   */
  test('TC-P5-04: hiện thực có `extraServers` ⇒ file VẪN được ghi dù 🚫 `ids` nào', async () => {
    class WithExtras extends WorkspaceFileMcpDelivery {
      protected override extraServers(): McpServer[] {
        return [
          McpRegistry.normalise({
            id: 'dev-team-dashboard',
            label: 'dashboard',
            enabled: true,
            transport: 'stdio',
            command: 'bun',
            args: ['mcp'],
            env: {},
          })!,
        ]
      }
    }
    const handle = await new WithExtras(runtimeDir, credentials).prepare({ ids: [], workspace, jobId: 'job-orch' })

    expect(handle).not.toBeNull()
    expect(fs.existsSync(configPath())).toBe(true)
    handle!.dispose()
  })
})

describe('WorkspaceFileMcpDelivery — nội dung, quyền, .gitignore', () => {
  /**
   * TC-P5-05 ⭐ · TC-P5-24 — nội dung đến từ serializer CHUNG: so thẳng với
   * `mcpRegistry.select(...).toCliConfig(...)` cho cùng input, và với file của
   * đường claude (`ConfigFlagMcpDelivery`) — hai cách giao 🚫 được lệch một byte.
   */
  test('TC-P5-05 / TC-P5-24: nội dung khớp serializer chung và khớp đường claude', async () => {
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    seed({ id: 'on2' })

    const expected = mcpRegistry.select({ ids: ['on1', 'on2'] })!.toCliConfig({ workspace, credentials })
    const handle = (await prepare({ ids: ['on1', 'on2'] }))!

    expect(handle.kind).toBe('workspace-config-file')
    expect(handle.path).toBe(configPath())
    expect(JSON.parse(fs.readFileSync(configPath(), 'utf8'))).toEqual(expected.json)
    expect(handle.names).toEqual(expected.names)
    expect(handle.masker.values).toEqual(expected.masker.values)
    expect(handle.warnings).toEqual(expected.warnings)
    expect(handle.count).toBe(2)

    // Đường claude trên CÙNG input ⇒ cùng nội dung.
    const claude = (await new ConfigFlagMcpDelivery(runtimeDir, credentials).prepare({
      ids: ['on1', 'on2'],
      workspace,
      jobId: 'job-claude-1',
    }))!
    expect(JSON.parse(fs.readFileSync(claude.path, 'utf8'))).toEqual(
      JSON.parse(fs.readFileSync(configPath(), 'utf8')),
    )
    expect(claude.kind).toBe('config-file-flag')
    claude.dispose()
    handle.dispose()
  })

  test('TC-P5-24 (b): `select` trả null khi 🚫 `ids` VÀ 🚫 `extras`', async () => {
    seed({ id: 'on1' })
    expect(mcpRegistry.select({ ids: [] })).toBeNull()
    expect(mcpRegistry.select({ ids: [], extras: [] })).toBeNull()
    expect(mcpRegistry.select({ ids: ['on1'] })).not.toBeNull()
  })

  // TC-P5-06 — ⚠️ skip có ghi chú trên nền 🚫 hỗ trợ mode, 🚫 xoá ca.
  test('TC-P5-06: quyền POSIX — mcp.json 0600, .cursor 0700 (khi CHÍNH ta tạo)', async () => {
    if (process.platform === 'win32') {
      // Trên win32 `chmod` gần như vô nghĩa; vị trí file mới là thứ bảo vệ.
      // Giữ ca lại để nền POSIX vẫn được chấm — 🚫 xoá.
      return
    }
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    const handle = (await prepare())!

    expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600)
    expect(fs.statSync(cursorDir()).mode & 0o777).toBe(0o700)
    handle.dispose()
  })

  test('TC-P5-06 (b): `.cursor/` SẴN CÓ của người dùng 🚫 bị hạ quyền', async () => {
    if (process.platform === 'win32') return
    seed({ id: 'on1' })
    fs.mkdirSync(cursorDir(), { recursive: true })
    fs.chmodSync(cursorDir(), 0o755)

    const handle = (await prepare())!
    expect(fs.statSync(cursorDir()).mode & 0o777).toBe(0o755)
    handle.dispose()
    expect(fs.statSync(cursorDir()).mode & 0o777).toBe(0o755)
  })

  // TC-P5-07 ⭐ — `git status` THẬT trên repo git THẬT.
  test('TC-P5-07: 🚫 có `.cursor/.gitignore` ⇒ tự tạo, `git status` 🚫 thấy file nào', async () => {
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    execFileSync('git', ['init', '-q'], { cwd: workspace })

    const handle = (await prepare())!

    expect(fs.existsSync(path.join(cursorDir(), '.gitignore'))).toBe(true)
    expect(fs.readFileSync(path.join(cursorDir(), '.gitignore'), 'utf8')).toContain('*')

    const status = execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
    expect(status).not.toContain('.cursor/mcp.json')
    expect(status).not.toContain('.cursor/')
    expect(status.trim()).toBe('')

    handle.dispose()
  })

  // TC-P5-08
  test('TC-P5-08: `.cursor/.gitignore` CỦA NGƯỜI DÙNG 🚫 bị sửa, còn nguyên sau dispose', async () => {
    seed({ id: 'on1' })
    fs.mkdirSync(cursorDir(), { recursive: true })
    const mine = '# của tôi\nrules/local\n'
    fs.writeFileSync(path.join(cursorDir(), '.gitignore'), mine, 'utf8')

    const handle = (await prepare())!
    expect(fs.readFileSync(path.join(cursorDir(), '.gitignore'), 'utf8')).toBe(mine)

    handle.dispose()
    expect(fs.existsSync(path.join(cursorDir(), '.gitignore'))).toBe(true)
    expect(fs.readFileSync(path.join(cursorDir(), '.gitignore'), 'utf8')).toBe(mine)
  })
})

describe('WorkspaceFileMcpDelivery — khôi phục nguyên trạng', () => {
  // TC-P5-09 ⭐
  test('TC-P5-09: `.cursor/mcp.json` sẵn có ⇒ trả lại BYTE-IDENTICAL, 🚫 hợp nhất', async () => {
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    fs.mkdirSync(cursorDir(), { recursive: true })
    const mine = '{\n  "mcpServers": {\n    "cua-toi": { "command": "ls" }\n  }\n}\n'
    fs.writeFileSync(configPath(), mine, 'utf8')

    const handle = (await prepare())!

    // Trong lúc job: file là cấu hình của dashboard, bản gốc nằm ở file sao lưu.
    const during = fs.readFileSync(configPath(), 'utf8')
    expect(during).not.toBe(mine)
    expect(during).toContain('on1')
    expect(cursorFiles().some((f) => f.includes('dashboard-backup'))).toBe(true)

    handle.dispose()

    expect(fs.readFileSync(configPath(), 'utf8')).toBe(mine)
    expect(cursorFiles().some((f) => f.includes('dashboard-backup'))).toBe(false)
    expect(filesWithCanary()).toEqual([])
    expect(ledger()).toEqual([])
  })

  // TC-P5-10
  test('TC-P5-10: `.cursor/` đã tồn tại từ trước ⇒ sau dispose vẫn CÒN', async () => {
    seed({ id: 'on1' })
    fs.mkdirSync(cursorDir(), { recursive: true })
    fs.writeFileSync(path.join(cursorDir(), 'rules.md'), 'quy tắc\n', 'utf8')

    const done = (await prepare())!
    done.dispose()

    expect(fs.existsSync(cursorDir())).toBe(true)
    expect(cursorFiles()).toEqual(['rules.md'])
  })

  // TC-P5-11
  test('TC-P5-11: `.cursor/` do chính lượt này tạo và rỗng sau khi dọn ⇒ bị xoá', async () => {
    seed({ id: 'on1' })
    const done = (await prepare())!
    done.dispose()

    expect(fs.existsSync(cursorDir())).toBe(false)
    expect(fs.readdirSync(workspace)).toEqual([])
  })

  // TC-P5-12
  test('TC-P5-12: file lạ xuất hiện giữa chừng ⇒ dispose 🚫 ném, thư mục giữ lại', async () => {
    seed({ id: 'on1' })
    const handle = (await prepare())!
    fs.writeFileSync(path.join(cursorDir(), 'ai-do-ghi.txt'), 'xin chào\n', 'utf8')

    expect(() => handle.dispose()).not.toThrow()
    expect(fs.existsSync(cursorDir())).toBe(true)
    expect(cursorFiles()).toContain('ai-do-ghi.txt')
  })

  // TC-P5-13 ⭐ — `dispose()` nằm trong `finally` của provider, nên ca này đo
  // chính hàm đó ở nhánh job ném: dọn xong và 🚫 nuốt lỗi của job.
  test('TC-P5-13: job ném giữa chừng ⇒ dispose vẫn dọn sạch, lỗi job vẫn nổi lên', async () => {
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    const handle = (await prepare())!

    expect(() => {
      try {
        throw new Error('job hỏng')
      } finally {
        handle.dispose()
      }
    }).toThrow('job hỏng')

    expect(fs.existsSync(cursorDir())).toBe(false)
    expect(filesWithCanary()).toEqual([])
    expect(ledger()).toEqual([])
  })

  // TC-P5-14
  test('TC-P5-14: ledger có đúng 1 entry lúc chạy, RỖNG sau dispose', async () => {
    seed({ id: 'on1' })
    const handle = (await prepare())!

    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ jobId: 'job-cursor-1', stage: 'written' })

    handle.dispose()
    expect(ledger()).toEqual([])
  })
})

describe('WorkspaceFileMcpDelivery.cleanupOrphans — lưới cuối sau `kill -9`', () => {
  /** Mô phỏng `kill -9`: ledger + file còn trên đĩa, `dispose()` 🚫 bao giờ chạy. */
  async function killNine(over: Partial<McpJobInput> = {}) {
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    const handle = (await prepare(over))!
    // 🚫 gọi `dispose()` — đúng cái mà `kill -9` lấy mất.
    return handle
  }

  // TC-P5-15 ⭐
  test('TC-P5-15: bootstrap dọn sạch — xoá config, khôi phục backup byte-identical', async () => {
    fs.mkdirSync(cursorDir(), { recursive: true })
    const mine = '{"mcpServers":{"cua-toi":{"command":"ls"}}}\n'
    fs.writeFileSync(configPath(), mine, 'utf8')
    await killNine()

    expect(ledger()).toHaveLength(1)
    expect(filesWithCanary().length).toBeGreaterThan(0)

    cleanupOrphans()

    expect(fs.readFileSync(configPath(), 'utf8')).toBe(mine)
    expect(filesWithCanary()).toEqual([])
    expect(cursorFiles()).toEqual(['mcp.json'])
    expect(ledger()).toEqual([])
  })

  test('TC-P5-15 (b): 🚫 backup (workspace sạch) ⇒ xoá hẳn config, `.gitignore` và `.cursor` cùng đi', async () => {
    await killNine()
    cleanupOrphans()

    expect(fs.existsSync(cursorDir())).toBe(false)
    expect(filesWithCanary()).toEqual([])
    expect(ledger()).toEqual([])
  })

  // TC-P5-16
  test('TC-P5-16: gọi dọn mồ côi HAI lần ⇒ lần hai 🚫 ném, 🚫 đổi gì', async () => {
    await killNine()
    cleanupOrphans()
    const after = fs.readdirSync(workspace).sort()

    expect(() => cleanupOrphans()).not.toThrow()
    expect(fs.readdirSync(workspace).sort()).toEqual(after)
    expect(ledger()).toEqual([])
  })

  // TC-P5-17
  test('TC-P5-17: entry mồ côi trỏ workspace ĐÃ BỊ XOÁ ⇒ 🚫 ném, entry bị gỡ', async () => {
    await killNine()
    fs.rmSync(workspace, { recursive: true, force: true })

    expect(() => cleanupOrphans()).not.toThrow()
    expect(ledger()).toEqual([])
  })
})

describe('#378 — chống đua trên cùng workspace (review vòng 1…3)', () => {
  /**
   * TC-P5-CONC ⭐ (review vòng 1) — interleaving A-start → B-start → A-dispose
   * → B-dispose. Hai job cùng project dùng CHUNG đúng một `.cursor/`.
   */
  test('TC-P5-CONC: hai job song song ⇒ file gốc byte-identical, 🚫 secret sót, 🚫 backup sót', async () => {
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    fs.mkdirSync(cursorDir(), { recursive: true })
    const mine = '{"mcpServers":{"cua-toi":{"command":"ls"}}}\n'
    fs.writeFileSync(configPath(), mine, 'utf8')
    const warnings: string[] = []

    const a = await prepare({ jobId: 'job-A' })
    const b = await prepare({ jobId: 'job-B', onWarning: (m: string) => warnings.push(m) })

    expect(a).not.toBeNull()
    // B 🚫 giành được khoá ⇒ chạy KHÔNG MCP, 🚫 ghi đè gì của A.
    expect(b).toBeNull()
    expect(warnings.join('\n')).toContain('đang được một job khác dùng')

    a!.dispose()
    b?.dispose()

    expect(fs.readFileSync(configPath(), 'utf8')).toBe(mine)
    expect(filesWithCanary()).toEqual([])
    expect(cursorFiles().filter((f) => f.includes('dashboard-backup'))).toEqual([])
    expect(cursorFiles()).not.toContain('.dashboard-lock')
    expect(ledger()).toEqual([])
  })

  test('TC-P5-CONC (b): khoá được nhả ⇒ job SAU vào được', async () => {
    seed({ id: 'on1' })
    const done = (await prepare({ jobId: 'job-A' }))!
    done.dispose()
    const second = await prepare({ jobId: 'job-B' })

    expect(second).not.toBeNull()
    second!.dispose()
    expect(ledger()).toEqual([])
  })

  /**
   * TC-P5-OVERWRITE (review vòng 2) — tiến trình NGOÀI (Cursor IDE) ghi đè
   * `.cursor/mcp.json` giữa job, giữ nguyên phần của ta nên file VẪN còn secret.
   * `dispose()` 🚫 được xoá file của người khác, nhưng cũng 🚫 được cởi lớp che.
   */
  test('TC-P5-OVERWRITE: ghi đè giữa job ⇒ `.gitignore` CÒN, ledger GIỮ entry', async () => {
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const handle = (await prepare({ jobId: 'job-A' }))!
      // Tiến trình khác ghi lại file, GIỮ block của ta ⇒ vẫn còn secret.
      const ours = fs.readFileSync(configPath(), 'utf8')
      fs.writeFileSync(configPath(), `${ours}\n// Cursor IDE đã ghi lại\n`, 'utf8')

      handle.dispose()

      // File 🚫 bị xoá (🚫 phải của ta) nhưng vẫn phải được che khỏi git…
      expect(fs.existsSync(configPath())).toBe(true)
      expect(fs.existsSync(path.join(cursorDir(), '.gitignore'))).toBe(true)
      // …và ledger GIỮ entry để bootstrap thử tiếp.
      expect(ledger()).toHaveLength(1)
      expect(warn).toHaveBeenCalled()
      expect(String(warn.mock.calls.at(-1)?.[0])).toContain(configPath())
    } finally {
      warn.mockRestore()
    }
  })

  /**
   * TC-P5-LOCKORPHAN (review vòng 2) — khoá treo trên đĩa nhưng ledger RỖNG
   * (chết đúng giữa `mkdir` khoá và lần ghi ledger đầu). Bootstrap phải gỡ được,
   * 🚫 để workspace treo vĩnh viễn.
   */
  test('TC-P5-LOCKORPHAN: khoá mồ côi + ledger rỗng ⇒ job mới VẪN giành được khoá', async () => {
    seed({ id: 'on1' })
    fs.mkdirSync(path.join(cursorDir(), '.dashboard-lock'), { recursive: true })
    expect(ledger()).toEqual([])

    // Bootstrap 🚫 có entry nào để duyệt — nhưng cũng 🚫 được ném.
    expect(() => cleanupOrphans()).not.toThrow()

    // ⚠️ GIỚI HẠN ĐÃ BIẾT, ghi ra chứ 🚫 giấu và cũng 🚫 khoá cứng thành kỳ vọng:
    // `cleanupOrphans()` chỉ duyệt LEDGER, nên một khoá 🚫 có
    // entry nào trỏ tới thì nó 🚫 gỡ được. Trạng thái đó 🚫 CÒN sinh ra được trên
    // đường chạy thật từ `7f9406d` (bản ghi TẠM của R2-2 ghi ledger NGAY sau khi
    // giành khoá — TC-P5-TEMPENTRY khoá đúng hình dạng thật đó), nên ca này
    // 🚫 assert "khoá vẫn còn": làm vậy là biến một giới hạn thành hợp đồng, và
    // bản sửa sau này sẽ đỏ vì đã sửa đúng. Chi tiết ở `test-result.md`.
    //
    // Vế ĐƯỢC khoá ở đây: khoá là thứ gỡ được, và gỡ xong job mới vào được NGAY —
    // 🚫 có trạng thái treo vĩnh viễn nào cần thêm bước khôi phục khác.
    fs.rmSync(path.join(cursorDir(), '.dashboard-lock'), { recursive: true, force: true })
    const after = await prepare({ jobId: 'job-moi-2' })
    expect(after).not.toBeNull()
    after!.dispose()
    expect(ledger()).toEqual([])
  })

  /**
   * TC-P5-TEMPENTRY (review vòng 3) — ledger CHỈ có entry tạm (`stage: 'locked'`)
   * + thư mục khoá trên đĩa. Bootstrap phải gỡ khoá, ledger về 0, job mới giành
   * được khoá. Đây là lý do bản ghi tạm tồn tại.
   */
  test('TC-P5-TEMPENTRY: entry `stage: locked` ⇒ bootstrap gỡ khoá, ledger 0, job mới vào được', async () => {
    seed({ id: 'on1' })
    fs.mkdirSync(path.join(cursorDir(), '.dashboard-lock'), { recursive: true })
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true })
    fs.writeFileSync(
      ledgerPath(),
      JSON.stringify({
        entries: [
          {
            jobId: 'job-chet',
            stage: 'locked',
            dir: cursorDir(),
            path: configPath(),
            lock: path.join(cursorDir(), '.dashboard-lock'),
            backup: null,
            dirExisted: false,
            gitignoreCreated: false,
            sha256: '',
          },
        ],
      }),
      'utf8',
    )

    cleanupOrphans()

    expect(ledger()).toEqual([])
    expect(fs.existsSync(path.join(cursorDir(), '.dashboard-lock'))).toBe(false)

    const handle = await prepare({ jobId: 'job-moi' })
    expect(handle).not.toBeNull()
    handle!.dispose()
  })

  /** Bộ ba STUCK-* chạy trên CÙNG một ca kẹt — dựng nó một lần ở đây. */
  async function makeStuck(): Promise<string> {
    seed({ id: 'on1', env: { TOKEN: CANARY } })
    fs.mkdirSync(cursorDir(), { recursive: true })
    const mine = '{"mcpServers":{"cua-toi":{"command":"ls"}}}\n'
    fs.writeFileSync(configPath(), mine, 'utf8')
    const handle = (await prepare({ jobId: 'job-ket' }))!
    fs.writeFileSync(configPath(), `${fs.readFileSync(configPath(), 'utf8')}\n// nguoi khac\n`, 'utf8')
    handle.dispose()
    return mine
  }

  /**
   * TC-P5-STUCK-IDEMPOTENT (review vòng 3) — 3 lượt bootstrap liên tiếp trên ca
   * kẹt: ledger luôn ĐÚNG 1 entry, `.gitignore` còn, trạng thái đĩa BẤT ĐỘNG.
   */
  test('TC-P5-STUCK-IDEMPOTENT: 3 lượt bootstrap ⇒ ledger luôn 1 entry, đĩa bất động', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await makeStuck()
      expect(ledger()).toHaveLength(1)
      const snapshot = () =>
        cursorFiles().map((f) => `${f}:${fs.readFileSync(path.join(cursorDir(), f), 'utf8')}`)
      const before = snapshot()

      for (let i = 1; i <= 3; i++) {
        cleanupOrphans()
        expect(ledger(), `lượt ${i}`).toHaveLength(1)
        expect(cursorFiles(), `lượt ${i}`).toContain('.gitignore')
        expect(snapshot(), `lượt ${i}`).toEqual(before)
      }
    } finally {
      warn.mockRestore()
    }
  })

  /**
   * TC-P5-STUCK-RECOVER (review vòng 3) — người dùng xoá file lạ ⇒ lượt bootstrap
   * KẾ TIẾP dọn sạch hết: ledger 0, `.gitignore` đã gỡ, bản sao lưu được đổi tên
   * về `mcp.json` với nội dung = file gốc.
   */
  test('TC-P5-STUCK-RECOVER: xoá file lạ ⇒ lượt 4 dọn sạch, file gốc trở về nguyên vẹn', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mine = await makeStuck()
      for (let i = 0; i < 3; i++) cleanupOrphans()
      expect(ledger()).toHaveLength(1)

      fs.rmSync(configPath(), { force: true })
      cleanupOrphans()

      expect(ledger()).toEqual([])
      expect(fs.existsSync(path.join(cursorDir(), '.gitignore'))).toBe(false)
      expect(fs.existsSync(configPath())).toBe(true)
      expect(fs.readFileSync(configPath(), 'utf8')).toBe(mine)
      expect(cursorFiles().filter((f) => f.includes('dashboard-backup'))).toEqual([])
      expect(filesWithCanary()).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  /**
   * TC-P5-STUCK-NOBLOCK (review vòng 3) — entry kẹt còn trong ledger 🚫 được gây
   * tác hại dây chuyền: job MỚI trên cùng workspace vẫn `prepare()` được, ledger
   * thành 2 entry, và `dispose()` của job mới 🚫 đụng entry kẹt.
   */
  test('TC-P5-STUCK-NOBLOCK: job MỚI cùng workspace vẫn chạy, 🚫 đụng entry kẹt', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await makeStuck()
      expect(ledger()).toHaveLength(1)
      const stuckBefore = ledger()[0]
      const gitignoreBefore = fs.existsSync(path.join(cursorDir(), '.gitignore'))

      const fresh = await prepare({ jobId: 'job-moi' })
      expect(fresh).not.toBeNull()
      expect(ledger()).toHaveLength(2)

      fresh!.dispose()

      const after = ledger()
      expect(after).toHaveLength(1)
      expect(after[0]).toEqual(stuckBefore)
      // Job mới 🚫 gỡ `.gitignore` của entry kẹt.
      expect(fs.existsSync(path.join(cursorDir(), '.gitignore'))).toBe(gitignoreBefore)
    } finally {
      warn.mockRestore()
    }
  })

  /**
   * [imo] R3-3 — entry THIẾU `stage` (ledger của build cũ / sửa tay) phải rơi về
   * nhánh THẬN TRỌNG: thử xoá có kiểm hash, hash lệch ⇒ giữ entry + giữ `.gitignore`.
   */
  test('R3-3: entry thiếu `stage` + hash lệch ⇒ nhánh thận trọng, 🚫 âm thầm bỏ qua', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      seed({ id: 'on1', env: { TOKEN: CANARY } })
      const handle = (await prepare({ jobId: 'job-cu' }))!
      fs.writeFileSync(configPath(), `${fs.readFileSync(configPath(), 'utf8')}\n// sửa tay\n`, 'utf8')

      // Gỡ `stage` khỏi ledger — mô phỏng bản ghi của build trước R3-3.
      const entries = ledger().map(({ stage, ...rest }: any) => rest)
      fs.writeFileSync(ledgerPath(), JSON.stringify({ entries }), 'utf8')
      expect(ledger()[0].stage).toBeUndefined()

      cleanupOrphans()

      expect(ledger()).toHaveLength(1)
      expect(fs.existsSync(configPath())).toBe(true)
      expect(fs.existsSync(path.join(cursorDir(), '.gitignore'))).toBe(true)
      handle.dispose()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('#378 — secret trong file 🚫 lọt vào log (TC-P5-23)', () => {
  // TC-P5-23
  test('TC-P5-23: file chứa giá trị ĐÃ GIẢI, nhưng handle.masker.values mang nó để mask log', async () => {
    process.env.CURSOR_TEST_TOKEN = CANARY
    try {
      seed({ id: 'on1', env: { TOKEN: 'env:CURSOR_TEST_TOKEN' } })
      const handle = (await prepare())!

      // File THỰC SỰ mang giá trị đã giải — nếu không thì server con 🚫 chạy được.
      expect(fs.readFileSync(configPath(), 'utf8')).toContain(CANARY)
      // …và danh sách mask của job mang đúng chuỗi đó, để log 🚫 lộ.
      expect(handle.masker.values).toContain(CANARY)
      // Tên hiển thị chỉ là id, 🚫 bao giờ là giá trị env.
      expect(JSON.stringify(handle.names)).not.toContain(CANARY)
      expect(JSON.stringify(handle.warnings)).not.toContain(CANARY)

      handle.dispose()
      expect(filesWithCanary()).toEqual([])
    } finally {
      delete process.env.CURSOR_TEST_TOKEN
    }
  })
})
