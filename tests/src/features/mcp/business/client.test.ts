import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeMcpServer } from '../../../../../src/features/mcp/business/client.js'
import {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_TIMEOUT_MS,
  resolveTimeoutMs,
  type McpStdioServer,
} from '../../../../../src/features/mcp/business/types.js'

/**
 * TC-28…TC-31 — `probeMcpServer` trên transport stdio, chạy server MCP THẬT
 * (`fake-mcp-server.mjs`) qua `node`. 🚫 Không mạng, 🚫 không mock transport:
 * vòng đời tiến trình con (G9) là thứ chỉ spawn thật mới bắt được.
 *
 * Ca http/sse không nằm trong suite tự động (test-spec §1.4) — kiểm thủ công + e2e.
 */

const FIXTURE = path.join(import.meta.dir, 'fake-mcp-server.mjs')

const tempFiles: string[] = []
afterEach(() => {
  for (const f of tempFiles.splice(0)) fs.rmSync(f, { force: true })
})

function fakeServer(mode: string, over: Partial<McpStdioServer> = {}): McpStdioServer {
  return {
    id: `fake-${mode}`,
    label: `fake ${mode}`,
    enabled: true,
    transport: 'stdio',
    command: process.execPath,
    args: [FIXTURE, mode],
    env: {},
    ...over,
  } as McpStdioServer
}

function pidFilePath(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-pid-')), 'pid')
  tempFiles.push(file)
  return file
}

/** `kill(pid, 0)` ném ESRCH ⇒ tiến trình đã biến mất. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntilDead(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !isAlive(pid)
}

describe('probeMcpServer — stdio', () => {
  // TC-28
  test('TC-28: probe thành công ⇒ serverInfo + tools theo shape `tools/list`', async () => {
    const result = await probeMcpServer(fakeServer('ok'), { listTools: true, timeoutMs: 15_000 })

    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.serverInfo?.name.length).toBeGreaterThan(0)
    expect(result.serverInfo?.version.length).toBeGreaterThan(0)
    expect(Array.isArray(result.tools)).toBe(true)
    expect(result.tools.length).toBeGreaterThanOrEqual(2)
    for (const tool of result.tools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
    }
    expect(result.tools.map((t) => t.name)).toContain('echo')
    expect(result.durationMs).toBeGreaterThan(0)
  }, 30_000)

  // TC-29 — E11 / G9
  test('TC-29: server treo ⇒ timeout resolve, 🚫 không rò tiến trình con', async () => {
    const pidFile = pidFilePath()
    const started = Date.now()
    // `env` của server đi thẳng vào env tiến trình con — fixture dùng nó để ghi PID.
    const result = await probeMcpServer(
      fakeServer('hang', { env: { FAKE_MCP_PID_FILE: pidFile } }),
      { listTools: true, timeoutMs: 1000 },
    )

    expect(Date.now() - started).toBeLessThan(5000)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/timed out/i)

    // PID ghi bởi chính fixture — không phụ thuộc nội tại của transport SDK.
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim())
    expect(Number.isInteger(pid)).toBe(true)
    expect(await waitUntilDead(pid)).toBe(true)
  }, 30_000)

  // TC-30
  test('TC-30: server chết ngay khi khởi động ⇒ ok false, error mang thông điệp gốc', async () => {
    const result = await probeMcpServer(fakeServer('crash'), { listTools: true, timeoutMs: 5000 })

    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error!.trim().length).toBeGreaterThan(0)
  }, 30_000)

  // TC-31
  test('TC-31: lệnh không tồn tại ⇒ ok false, không ném, không treo', async () => {
    const result = await probeMcpServer(
      fakeServer('ok', { command: 'dtd-lenh-chac-chan-khong-ton-tai-9f2a', args: [] }),
      { listTools: true, timeoutMs: 5000 },
    )

    expect(result.ok).toBe(false)
    expect(result.error!.trim().length).toBeGreaterThan(0)
  }, 30_000)
})

/* ─── Tdad47b2b · nhóm D — Kiểm tra kết nối chạy cùng điều kiện với job ───── */

/**
 * TC-D01…TC-D11 — acceptance criterion gốc: *cấu hình kiểm tra thì fail, nhưng
 * hỏi agent thì vẫn lấy được danh sách tool*.
 *
 * Nguyên nhân: lượt kiểm tra chạy với điều kiện HẸP HƠN lúc job chạy — chỉ 6 biến
 * môi trường của `getDefaultEnvironment()`, và timeout khởi động ngắn hơn. Nhóm
 * này chốt hai điều kiện đã khép, cộng ba chênh lệch còn lại là CỐ Ý.
 *
 * ⚠️ Mọi ca tự đặt biến môi trường của mình rồi khôi phục — 🚫 không ca nào dựa
 * vào biến sẵn có của máy dev (`AGENTS.md` §6).
 */
const SLOW_START_MS = 15_500 // > mặc định CŨ 15s, << mặc định MỚI 120s

function envDumpFile(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-env-')), 'env.json')
  tempFiles.push(file)
  return file
}
function childDump(file: string): { env: Record<string, string>; cwd: string } {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
function childEnv(file: string): Record<string, string> {
  return childDump(file).env
}

/** Đặt biến rồi khôi phục đúng trạng thái cũ (kể cả «trước đó không tồn tại»). */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prev = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(vars)) {
    prev.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('probeMcpServer — env truyền xuống server con (nhóm D)', () => {
  // TC-D01
  test('TC-D01: biến NGOÀI danh sách hẹp cũ vẫn tới được tiến trình con', async () => {
    const file = envDumpFile()
    const result = await withEnv({ MCP_PROBE_CANARY: 'xin-chao' }, () =>
      probeMcpServer(fakeServer('ok', { env: { FAKE_MCP_ENV_FILE: file } }), {
        listTools: true,
        timeoutMs: 15_000,
      }),
    )

    expect(result.ok).toBe(true)
    // Trước đây chỉ 6 biến của `getDefaultEnvironment()` tới được đây.
    expect(childEnv(file).MCP_PROBE_CANARY).toBe('xin-chao')
  }, 30_000)

  // TC-D02
  test('TC-D02: biến khai riêng cho server THẮNG biến cùng tên của tiến trình dashboard', async () => {
    const file = envDumpFile()
    const result = await withEnv({ MCP_PROBE_OVERRIDE: 'env-ngoai' }, () =>
      probeMcpServer(
        fakeServer('ok', { env: { FAKE_MCP_ENV_FILE: file, MCP_PROBE_OVERRIDE: 'cua-server' } }),
        { listTools: true, timeoutMs: 15_000 },
      ),
    )

    expect(result.ok).toBe(true)
    expect(childEnv(file).MCP_PROBE_OVERRIDE).toBe('cua-server')
  }, 30_000)

  // TC-D03
  test('TC-D03: biến rỗng / biến đã xoá ⇒ lượt kiểm tra vẫn chạy, 🚫 không ném vì `undefined`', async () => {
    const file = envDumpFile()
    const result = await withEnv({ MCP_PROBE_EMPTY: '', MCP_PROBE_DELETED: undefined }, () =>
      probeMcpServer(fakeServer('ok', { env: { FAKE_MCP_ENV_FILE: file } }), {
        listTools: true,
        timeoutMs: 15_000,
      }),
    )

    expect(result.ok).toBe(true)
    const env = childEnv(file)
    expect(env.MCP_PROBE_EMPTY).toBe('')
    expect(env).not.toHaveProperty('MCP_PROBE_DELETED')
  }, 30_000)

  /**
   * TC-D11 — ba biến do CLI bơm lúc chạy job.
   *
   * Ghi nhận chênh lệch ĐÃ CHẤP NHẬN (`design.md` §6): lượt kiểm tra 🚫 không tự
   * bơm ba biến này. Ca chốt là probe không sinh ra chúng — 🚫 không đòi hỏi
   * ngược lại. Phải tự xoá chúng khỏi tiến trình cha trước, vì từ khi probe bơm
   * full `process.env` thì «cha có ⇒ con có» là đúng và không nói lên gì.
   */
  test('TC-D11: probe 🚫 KHÔNG tự bơm `CLAUDE_PROJECT_DIR` / `CLAUDE_CODE_SESSION_ID` / `CLAUDECODE`', async () => {
    const file = envDumpFile()
    const result = await withEnv(
      { CLAUDE_PROJECT_DIR: undefined, CLAUDE_CODE_SESSION_ID: undefined, CLAUDECODE: undefined },
      () =>
        probeMcpServer(fakeServer('ok', { env: { FAKE_MCP_ENV_FILE: file } }), {
          listTools: true,
          timeoutMs: 15_000,
        }),
    )

    expect(result.ok).toBe(true)
    const env = childEnv(file)
    for (const key of ['CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_SESSION_ID', 'CLAUDECODE']) {
      expect(env).not.toHaveProperty(key)
    }
  }, 30_000)
})

describe('probeMcpServer — timeout khởi động (nhóm D)', () => {
  /**
   * TC-D04 — mặc định timeout khởi động khớp job.
   *
   * Server khởi động chậm hơn mặc định CŨ (15s) nhưng nhanh hơn mặc định MỚI
   * (120s) ⇒ lượt kiểm tra 🚫 không được bỏ cuộc. Vế «job cũng vậy» nằm ở
   * `mcpJobConfig.test.ts` TC-E06: server không khai timeout ⇒ file config
   * 🚫 không có `startupTimeoutSec` ⇒ job dùng đúng mặc định 120s của CLI.
   */
  test('TC-D04: server 🚫 không khai timeout, khởi động chậm hơn 15s ⇒ vẫn PASS', async () => {
    const started = Date.now()
    const result = await probeMcpServer(
      fakeServer('ok', { env: { FAKE_MCP_DELAY_MS: String(SLOW_START_MS) } }),
      { listTools: true },
    )

    expect(result.ok).toBe(true)
    expect(result.tools.map((t) => t.name)).toContain('echo')
    // Đã thật sự chờ qua mốc cũ, 🚫 không phải server trả lời ngay.
    expect(Date.now() - started).toBeGreaterThan(15_000)
  }, 90_000)

  /**
   * TC-D05 — trần timeout đã nới.
   *
   * ⚠️ NỢ TEST một phần: chờ thật 300s là không chấp nhận được trong suite, và
   * độ trễ nằm trong TIẾN TRÌNH CON nên đồng hồ giả không với tới. Ca này chốt
   * đúng thứ chốt được mà không chờ: **ngân sách hiệu lực** của lượt probe —
   * `resolveTimeoutMs` là hàm duy nhất quyết định con số đó. Trần CŨ là 60000;
   * nó còn sống thì ca này đỏ. 🚫 Không hạ kỳ vọng về mốc 60s.
   */
  test('TC-D05: server khai 300000 ⇒ ngân sách hiệu lực là 300000, 🚫 không bị cắt về 60s', () => {
    expect(resolveTimeoutMs(undefined, 300_000)).toBe(300_000)
    expect(resolveTimeoutMs(undefined, 300_000)).toBeGreaterThan(60_000)
    // Trần mới vẫn là trần: giá trị vượt nó bị kẹp, 🚫 không truyền thẳng.
    expect(resolveTimeoutMs(undefined, MCP_MAX_TIMEOUT_MS + 1)).toBe(MCP_MAX_TIMEOUT_MS)
    // 🚫 Không khai gì ⇒ mặc định mới, không phải mốc cũ.
    expect(resolveTimeoutMs(undefined, undefined)).toBe(MCP_DEFAULT_TIMEOUT_MS)
  })

  // TC-D06
  test('TC-D06: server khai 5000 mà khởi động lâu hơn ⇒ bỏ cuộc đúng theo giá trị đã khai', async () => {
    const started = Date.now()
    const result = await probeMcpServer(
      fakeServer('ok', { timeoutMs: 5000, env: { FAKE_MCP_DELAY_MS: '30000' } }),
      { listTools: true },
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/timed out/i)
    // Rút ngắn phải thật sự rút ngắn — 🚫 không rơi về mặc định 120s.
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 60_000)

  /**
   * TC-29b — `timeoutMs` là NGÂN SÁCH TỔNG cho cả lượt, 🚫 không phải hạn mức
   * từng bước: `connect` và `tools/list` chia chung một deadline.
   *
   * Bắt tay mất ~1500ms rồi server nuốt `tools/list`. Cấp trọn ngân sách cho mỗi
   * bước thì `tools/list` được đủ 3000ms; chia chung thì nó chỉ còn phần dư.
   * Assert trên con số TRONG thông điệp thay vì trên đồng hồ tường: `client.close()`
   * của transport stdio tốn thêm ~2s cố định, để ngưỡng thời gian bám nó là ca
   * nhấp nháy.
   */
  test('TC-29b: bắt tay chậm rồi treo ⇒ `tools/list` chỉ được phần NGÂN SÁCH CÒN LẠI', async () => {
    const budgetMs = 3000
    const started = Date.now()
    const result = await probeMcpServer(
      fakeServer('init-then-hang', { env: { FAKE_MCP_DELAY_MS: '1500' } }),
      { listTools: true, timeoutMs: budgetMs },
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/timed out/i)

    const waited = Number(/after (\d+)ms/.exec(result.error!)?.[1])
    expect(Number.isFinite(waited)).toBe(true)
    expect(waited).toBeLessThan(budgetMs)
    // Cả lượt vẫn nằm trong ngân sách + chi phí dọn tiến trình con (~2s).
    expect(Date.now() - started).toBeLessThan(budgetMs + 3000)
  }, 60_000)
})

describe('probeMcpServer — kịch bản hồi quy và thông điệp lỗi (nhóm D)', () => {
  /**
   * TC-D07 — kịch bản hồi quy của bug gốc, dựng lại đủ CẢ HAI điều kiện: server
   * phụ thuộc một biến env ngoài danh sách hẹp cũ VÀ khởi động lâu hơn mốc 15s.
   * Trước thay đổi, lượt kiểm tra fail ở cả hai lý do trong khi job vẫn chạy được.
   */
  test('TC-D07: server cần biến env ngoài danh sách cũ + khởi động chậm ⇒ kiểm tra PASS và lấy được tool', async () => {
    const result = await withEnv({ MCP_PROBE_NEEDED: 'co-mat' }, () =>
      probeMcpServer(
        fakeServer('ok', {
          env: { FAKE_MCP_REQUIRED_ENV: 'MCP_PROBE_NEEDED', FAKE_MCP_DELAY_MS: String(SLOW_START_MS) },
        }),
        { listTools: true },
      ),
    )

    expect(result.ok).toBe(true)
    expect(result.tools.map((t) => t.name)).toContain('echo')
  }, 90_000)

  // TC-D07 (đối chứng) — thiếu đúng biến đó thì vẫn fail: ca trên 🚫 không xanh vì lý do khác.
  test('TC-D07 (đối chứng): thiếu biến bắt buộc ⇒ lượt kiểm tra FAIL', async () => {
    const result = await withEnv({ MCP_PROBE_NEEDED: undefined }, () =>
      probeMcpServer(fakeServer('ok', { env: { FAKE_MCP_REQUIRED_ENV: 'MCP_PROBE_NEEDED' } }), {
        listTools: true,
        timeoutMs: 10_000,
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.error!.trim().length).toBeGreaterThan(0)
  }, 30_000)

  // TC-D08 — nới điều kiện 🚫 KHÔNG được biến lỗi thật thành pass giả.
  test('TC-D08: lệnh không tồn tại / server chết / URL remote không kết nối được ⇒ vẫn FAIL', async () => {
    const missingCommand = await probeMcpServer(
      fakeServer('ok', { command: 'dtd-lenh-chac-chan-khong-ton-tai-9f2a', args: [] }),
      { listTools: true, timeoutMs: 5000 },
    )
    expect(missingCommand.ok).toBe(false)

    const crashed = await probeMcpServer(fakeServer('crash'), { listTools: true, timeoutMs: 5000 })
    expect(crashed.ok).toBe(false)

    // Loopback cổng 1: từ chối kết nối ngay, 🚫 không ra mạng ngoài (§1.4).
    const refused = await probeMcpServer(
      {
        id: 'remote-refused',
        label: 'remote refused',
        enabled: true,
        transport: 'http',
        url: 'http://127.0.0.1:1/mcp',
        headers: {},
      } as any,
      { listTools: true, timeoutMs: 5000 },
    )
    expect(refused.ok).toBe(false)
    expect(refused.error!.trim().length).toBeGreaterThan(0)
  }, 60_000)

  /**
   * TC-D09 — thông điệp lỗi che bí mật, 🚫 KHÔNG che thứ cần đọc.
   *
   * Từ khi probe bơm full `process.env` xuống tiến trình con, giá trị secret của
   * HOST nằm trong tầm với của server con ⇒ danh sách mask phải phủ theo. Nhưng
   * lọc theo ĐỘ DÀI đơn thuần sẽ nuốt cả `PATH`/`HOME` — đúng thứ duy nhất người
   * dùng có để sửa cấu hình. Ca này chốt CẢ HAI chiều.
   */
  test('TC-D09: giá trị trông như secret bị che; `HOME` và biến thường hiện NGUYÊN VĂN', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-home-canary-'))
    const apiKey = 'sk-canary-0123456789abcdef'
    const plain = 'gia-tri-khong-phai-secret-0123'

    const result = await withEnv(
      { HOME: home, MCP_PROBE_API_KEY: apiKey, MCP_PROBE_PLAIN: plain },
      () =>
        probeMcpServer(
          // Lệnh không tồn tại mang cả ba chuỗi ⇒ thông điệp ENOENT chứa đủ chúng.
          fakeServer('ok', { command: `${home}/${plain}/khong-ton-tai-${apiKey}`, args: [] }),
          { listTools: true, timeoutMs: 5000 },
        ),
    )
    fs.rmSync(home, { recursive: true, force: true })

    expect(result.ok).toBe(false)
    // (a) khoá trông như secret (`…_API_KEY`) + giá trị đủ dài ⇒ bị che.
    expect(result.error).not.toContain(apiKey)
    expect(result.error).toContain('***')
    // (b) `HOME` và khoá thường ⇒ nguyên văn, dù giá trị cũng dài y hệt.
    expect(result.error).toContain(home)
    expect(result.error).toContain(plain)
  }, 30_000)

  /**
   * TC-D10 — `cwd` là chênh lệch CỐ Ý (`design.md` §4.2.E, §6), 🚫 không test
   * đồng bộ. Điều được chốt: chênh lệch vẫn được NÓI RÕ — cấu hình `mcpServers`
   * của CLI không có khoá `cwd`, nên lượt sinh file config vẫn phát warning khi
   * server khai `cwd` khác workspace của job (`serialize.test.ts` TC-19).
   * Ở đây chốt vế của probe: `cwd` khai ở server ĐƯỢC probe tôn trọng.
   */
  test('TC-D10: `cwd` của server áp dụng cho lượt kiểm tra (job thì không — chênh lệch cố ý)', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-cwd-'))
    const file = envDumpFile()
    const result = await probeMcpServer(
      fakeServer('ok', { cwd, env: { FAKE_MCP_ENV_FILE: file } }),
      { listTools: true, timeoutMs: 15_000 },
    )

    expect(result.ok).toBe(true)
    expect(fs.realpathSync(childDump(file).cwd)).toBe(fs.realpathSync(cwd))
    fs.rmSync(cwd, { recursive: true, force: true })
  }, 30_000)
})
