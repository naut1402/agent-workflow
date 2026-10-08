import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openMcpSession, probeMcpServer } from '../../../../../src/features/mcp/business/client.js'
import { startFakeMcpHttp } from './fake-mcp-http.mjs'
import {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_TIMEOUT_MS,
  resolveTimeoutMs,
  type McpRemoteServer,
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

/**
 * TC-SEC-01…TC-SEC-15 — guard redirect của probe (#385 SEC-1…SEC-4, PR 1).
 *
 * Bề mặt: `probeMcpServer` + server HTTP thật (`fake-mcp-http.mjs`). 🚫 Không
 * mock `fetch`: thứ phải chứng minh là **header nào thật sự rời tiến trình**, mà
 * chỉ một server nhận thật mới trả lời được câu đó.
 *
 * ⚠️ Mọi ca ở nhóm này chạy HAI LƯỢT (`http` và `sse`) bằng vòng lặp — hai
 * transport dùng chung một đường fetch, và xử lý redirect thủ công trên đường
 * streaming là chỗ dễ vỡ nhất của mục này (`test-spec.md` §3.1).
 *
 * 📌 Chọn status theo ngữ nghĩa HTTP, 🚫 không theo thói quen:
 * `307`/`308` giữ method + body, `301`/`302`/`303` hạ POST xuống GET. Ca "redirect
 * hợp lệ vẫn chạy được" (TC-SEC-05/06/08/14) vì vậy dùng `307` ở lượt `http`
 * (initialize là POST) — dùng `302` ở đó thì request MCP mất body và ca hỏng vì
 * đúng hành vi mà TC-SEC-12 đang khoá, 🚫 không phải vì guard. Lượt `sse` mở
 * stream bằng GET nên `302` chạy được, và TC-SEC-06 kiểm đúng vế đó.
 */
const SEC_CANARY = 'sk-test-LEAKCANARY-0123456789'
const TRANSPORTS = ['http', 'sse'] as const

function entryPathOf(transport: 'http' | 'sse'): string {
  return transport === 'sse' ? '/sse' : '/mcp'
}

/** `307` ở lượt `http` (giữ POST + body), `302` ở lượt `sse` (mở stream bằng GET). */
function keepMethodStatus(transport: 'http' | 'sse'): number {
  return transport === 'sse' ? 302 : 307
}

function remoteServer(
  transport: 'http' | 'sse',
  url: string,
  over: Partial<McpRemoteServer> = {},
): McpRemoteServer {
  return {
    id: `remote-${transport}`,
    label: `remote ${transport}`,
    enabled: true,
    transport,
    url,
    headers: {},
    ...over,
  } as McpRemoteServer
}

describe('probeMcpServer — guard redirect (nhóm A của #385)', () => {
  for (const transport of TRANSPORTS) {
    const entry = entryPathOf(transport)
    const keep = () => keepMethodStatus(transport)

    // TC-SEC-01 ⭐
    test(`TC-SEC-01 [${transport}]: redirect sang http công khai ⇒ CHẶN ở đích cuối`, async () => {
      const srv = await startFakeMcpHttp({ mode: transport })
      srv.plan = ({ pathname }) =>
        pathname === entry ? { status: 302, location: 'http://example.com/mcp' } : null
      try {
        const result = await probeMcpServer(
          remoteServer(transport, srv.url(entry), { headers: { 'X-API-Key': SEC_CANARY } }),
          { listTools: true, timeoutMs: 8000 },
        )

        expect(result.ok).toBe(false)
        expect(result.error).toContain('loopback/private')
        // 🚫 Không có hop nào đi tiếp: hop cuối ghi nhận được chính là hop 1.
        expect(srv.hops).toHaveLength(1)
      } finally {
        await srv.close()
      }
    }, 20_000)

    /**
     * TC-SEC-02 — phân biệt rõ với TC-SEC-01: guard chặn vì **scheme + host**,
     * 🚫 không phải vì "có redirect". Đích là TLD `.invalid` (RFC 2606) nên lượt
     * chạy 🚫 không hề gọi ra mạng ngoài — nó hỏng ở phân giải tên.
     */
    test(`TC-SEC-02 [${transport}]: redirect sang https công khai ⇒ guard CHO QUA`, async () => {
      const srv = await startFakeMcpHttp({ mode: transport })
      srv.plan = ({ pathname }) =>
        pathname === entry
          ? { status: 302, location: 'https://mcp-redirect-target.invalid/mcp' }
          : null
      try {
        const result = await probeMcpServer(remoteServer(transport, srv.url(entry)), {
          listTools: true,
          timeoutMs: 8000,
        })

        expect(result.ok).toBe(false)
        // Lỗi KHÔNG phải của chính sách endpoint — nó đã đi tiếp và hỏng ở tầng mạng.
        expect(result.error).not.toContain('loopback/private')
        expect(result.error).not.toContain('chỉ chấp nhận https')
        expect(result.error).not.toContain('vượt quá')
        expect(srv.hops).toHaveLength(1)
      } finally {
        await srv.close()
      }
    }, 20_000)

    // TC-SEC-03 ⭐ — header TUỲ CHỈNH, đổi origin (vẫn loopback nên guard cho qua).
    test(`TC-SEC-03 [${transport}]: đổi origin ⇒ header tuỳ chỉnh bị BỎ`, async () => {
      const a = await startFakeMcpHttp({ mode: transport })
      const b = await startFakeMcpHttp({ mode: transport })
      a.plan = ({ pathname }) =>
        pathname === entry ? { status: keep(), location: b.url(entry) } : null
      try {
        await probeMcpServer(
          remoteServer(transport, a.url(entry), { headers: { 'X-API-Key': SEC_CANARY } }),
          { listTools: true, timeoutMs: 8000 },
        )

        // Chứng cứ đối chứng: hop 1 (cùng origin người dùng khai) CÓ nhận header.
        expect(a.hops[0]?.headers['x-api-key']).toBe(SEC_CANARY)
        // Hop 2 ở origin khác: 🚫 không khoá nào, và quét toàn bộ header tìm canary ⇒ 0.
        expect(b.hops.length).toBeGreaterThanOrEqual(1)
        expect(b.hops[0]?.headers['x-api-key']).toBeUndefined()
        expect(b.headerDump()).not.toContain(SEC_CANARY)
      } finally {
        await a.close()
        await b.close()
      }
    }, 20_000)

    // TC-SEC-04 — `Authorization` chuẩn: chứng minh ta 🚫 chỉ dựa vào hành vi mặc định của `fetch`.
    test(`TC-SEC-04 [${transport}]: đổi origin ⇒ Authorization cũng bị bỏ`, async () => {
      const a = await startFakeMcpHttp({ mode: transport })
      const b = await startFakeMcpHttp({ mode: transport })
      a.plan = ({ pathname }) =>
        pathname === entry ? { status: keep(), location: b.url(entry) } : null
      try {
        await probeMcpServer(
          remoteServer(transport, a.url(entry), { credentialId: 'cred-1' }),
          { listTools: true, timeoutMs: 8000, secret: SEC_CANARY },
        )

        expect(a.hops[0]?.headers.authorization).toBe(`Bearer ${SEC_CANARY}`)
        expect(b.hops[0]?.headers.authorization).toBeUndefined()
        expect(b.headerDump()).not.toContain(SEC_CANARY)
      } finally {
        await a.close()
        await b.close()
      }
    }, 20_000)

    // TC-SEC-05 ⭐ — chống hồi quy cho lựa chọn "redirect thủ công" thay vì "chặn hẳn redirect".
    test(`TC-SEC-05 [${transport}]: redirect CÙNG origin ⇒ chạy được, header vẫn sang hop 2`, async () => {
      const srv = await startFakeMcpHttp({ mode: transport })
      const dest = `${entry}/`
      srv.plan = ({ pathname }) =>
        pathname === entry ? { status: keep(), location: dest } : null
      try {
        const result = await probeMcpServer(
          remoteServer(transport, srv.url(entry), { headers: { 'X-API-Key': SEC_CANARY } }),
          { listTools: true, timeoutMs: 8000 },
        )

        expect(result.ok).toBe(true)
        expect(result.tools.map((t) => t.name).sort()).toEqual(['echo', 'ping'])

        const hop2 = srv.hops.find((h) => h.path.startsWith(dest))
        expect(hop2).toBeDefined()
        expect(hop2?.headers['x-api-key']).toBe(SEC_CANARY)
        // Header gửi đúng MỘT giá trị, 🚫 không `"tok, tok"` như bản spread cũ.
        expect(String(hop2?.headers['x-api-key'])).not.toContain(',')
      } finally {
        await srv.close()
      }
    }, 20_000)

    // TC-SEC-07 ⭐ — A-1: giới hạn 3 lần chuyển hướng ⇒ tối đa 4 request.
    test(`TC-SEC-07 [${transport}]: vòng redirect vô hạn ⇒ dừng ở đúng 4 request`, async () => {
      const srv = await startFakeMcpHttp({ mode: transport })
      srv.plan = ({ index }) => ({ status: keep(), location: `${entry}?n=${index + 1}` })
      try {
        const started = Date.now()
        const result = await probeMcpServer(remoteServer(transport, srv.url(entry)), {
          listTools: true,
          timeoutMs: 8000,
        })

        expect(result.ok).toBe(false)
        expect(result.error).toContain('vượt quá 3 lần chuyển hướng')
        // Không 5, không 3 — hop 0,1,2,3.
        expect(srv.hops).toHaveLength(4)
        expect(Date.now() - started).toBeLessThan(8000)
      } finally {
        await srv.close()
      }
    }, 20_000)

    // TC-SEC-08 — biên còn lại của A-1: đúng 3 hop rồi 200 ⇒ THÀNH CÔNG.
    test(`TC-SEC-08 [${transport}]: đúng 3 lần chuyển hướng rồi 200 ⇒ thành công`, async () => {
      const srv = await startFakeMcpHttp({ mode: transport })
      const chain: Record<string, string> = {
        [entry]: `${entry}-r1`,
        [`${entry}-r1`]: `${entry}-r2`,
        [`${entry}-r2`]: `${entry}-r3`,
      }
      srv.plan = ({ pathname }) =>
        chain[pathname] ? { status: keep(), location: chain[pathname] } : null
      try {
        const result = await probeMcpServer(remoteServer(transport, srv.url(entry)), {
          listTools: true,
          timeoutMs: 8000,
        })

        expect(result.ok).toBe(true)
        expect(result.tools).toHaveLength(2)
      } finally {
        await srv.close()
      }
    }, 20_000)

    /**
     * TC-SEC-09 — `3xx` thiếu `Location` 🚫 không phải redirect: trả nguyên cho
     * SDK. Điều được khoá ở đây là **🚫 không treo** và **lỗi phát ra 🚫 phải của
     * chính guard** (nó là lỗi tầng SDK/transport).
     */
    test(`TC-SEC-09 [${transport}]: 302 thiếu Location ⇒ 🚫 treo, lỗi thuộc tầng SDK`, async () => {
      const srv = await startFakeMcpHttp({ mode: transport })
      srv.plan = ({ pathname }) => (pathname === entry ? { status: 302 } : null)
      try {
        const started = Date.now()
        const result = await probeMcpServer(remoteServer(transport, srv.url(entry)), {
          listTools: true,
          timeoutMs: 8000,
        })

        expect(result.ok).toBe(false)
        expect(result.error).toBeTruthy()
        expect(result.error).not.toContain('vượt quá')
        expect(result.error).not.toContain('loopback/private')
        expect(Date.now() - started).toBeLessThan(5000)
        expect(srv.hops).toHaveLength(1)
      } finally {
        await srv.close()
      }
    }, 20_000)

    // TC-SEC-10 — A → B → A: header bị bỏ ở lần đổi origin là bỏ VĨNH VIỄN.
    test(`TC-SEC-10 [${transport}]: vòng A→B→A ⇒ 🚫 khôi phục lại header ở A`, async () => {
      const a = await startFakeMcpHttp({ mode: transport })
      const b = await startFakeMcpHttp({ mode: transport })
      const backPath = `${entry}-back`
      a.plan = ({ pathname }) =>
        pathname === entry ? { status: keep(), location: b.url(entry) } : null
      b.plan = ({ pathname }) =>
        pathname === entry ? { status: keep(), location: a.url(backPath) } : null
      try {
        await probeMcpServer(
          remoteServer(transport, a.url(entry), { headers: { 'X-API-Key': SEC_CANARY } }),
          { listTools: true, timeoutMs: 8000 },
        )

        const back = a.hops.find((h) => h.path.startsWith(backPath))
        expect(back).toBeDefined()
        expect(back?.headers['x-api-key']).toBeUndefined()
        expect(b.headerDump()).not.toContain(SEC_CANARY)
        expect(JSON.stringify(back?.headers)).not.toContain(SEC_CANARY)
      } finally {
        await a.close()
        await b.close()
      }
    }, 20_000)

    // TC-SEC-13 — credential đã giải 🚫 xuất hiện ở thông điệp lỗi / warning nào của probe.
    test(`TC-SEC-13 [${transport}]: credential đã giải 🚫 lọt vào kết quả probe`, async () => {
      const srv = await startFakeMcpHttp({ mode: transport })
      srv.plan = ({ pathname }) =>
        pathname === entry ? { status: keep(), location: `${entry}-x` } : null
      try {
        const result = await probeMcpServer(
          remoteServer(transport, srv.url(entry), { credentialId: 'cred-1' }),
          { listTools: true, timeoutMs: 8000, secret: SEC_CANARY },
        )

        expect(JSON.stringify(result)).not.toContain(SEC_CANARY)
      } finally {
        await srv.close()
      }
    }, 20_000)

    // TC-SEC-14 — `Location` tương đối: resolve theo URL hiện tại rồi chạy LẠI guard.
    test(`TC-SEC-14 [${transport}]: Location tương đối ⇒ resolve + guard lại, 🚫 ném`, async () => {
      const srv = await startFakeMcpHttp({ mode: transport })
      const dest = `${entry}/v2`
      srv.plan = ({ pathname }) => (pathname === entry ? { status: keep(), location: dest } : null)
      try {
        const result = await probeMcpServer(remoteServer(transport, srv.url(entry)), {
          listTools: true,
          timeoutMs: 8000,
        })

        expect(result.ok).toBe(true)
        expect(srv.hops.some((h) => h.path.startsWith(dest))).toBe(true)
      } finally {
        await srv.close()
      }
    }, 20_000)

    /**
     * TC-SEC-15 — `Location` rác. "Rác" có hai hình dạng khác nhau và chúng đi
     * hai nhánh khác nhau của `guardedFetch`, nên phải tách thành hai ca:
     *
     *   (a) `ht!tp://` — `new URL` **KHÔNG** ném: `!` 🚫 hợp lệ trong scheme nên
     *       chuỗi rơi về tham chiếu TƯƠNG ĐỐI. Hành vi đúng là resolve rồi chạy
     *       LẠI guard trên URL mới (cùng origin ⇒ cho qua) — ca này khoá đúng
     *       điểm đó: có một hop thật đi tới đường dẫn đã resolve.
     *   (b) `http://[` — `new URL` ném thật ⇒ nhánh `catch` trả nguyên 3xx cho
     *       SDK, và lỗi phát ra là lỗi tầng SDK/transport.
     *
     * Vế chung của cả hai: 🚫 `TypeError` trần nào thoát ra ngoài, 🚫 treo.
     */
    test(`TC-SEC-15 [${transport}]: Location rác ⇒ 🚫 ném, 🚫 treo`, async () => {
      // (a) — không ném khi parse ⇒ resolve tương đối + guard lại.
      {
        const srv = await startFakeMcpHttp({ mode: transport })
        srv.plan = ({ pathname }) =>
          pathname === entry ? { status: keep(), location: 'ht!tp://' } : null
        try {
          const started = Date.now()
          const result = await probeMcpServer(remoteServer(transport, srv.url(entry)), {
            listTools: true,
            timeoutMs: 8000,
          })

          expect(String(result.error ?? '')).not.toContain('TypeError')
          expect(Date.now() - started).toBeLessThan(5000)
          // Guard chạy lại trên URL đã resolve (cùng origin) ⇒ hop 2 có thật.
          expect(srv.hops.some((h) => h.path.includes('ht!tp'))).toBe(true)
        } finally {
          await srv.close()
        }
      }

      // (b) — `new URL` ném ⇒ 3xx trả nguyên cho SDK, probe hỏng gọn.
      {
        const srv = await startFakeMcpHttp({ mode: transport })
        srv.plan = ({ pathname }) =>
          pathname === entry ? { status: 302, location: 'http://[' } : null
        try {
          const started = Date.now()
          const result = await probeMcpServer(remoteServer(transport, srv.url(entry)), {
            listTools: true,
            timeoutMs: 8000,
          })

          expect(result.ok).toBe(false)
          expect(result.error).toBeTruthy()
          expect(result.error).not.toContain('TypeError')
          // 🚫 Không hop nào đi tiếp: URL 🚫 parse được thì 🚫 có đích để đi.
          expect(srv.hops).toHaveLength(1)
          expect(Date.now() - started).toBeLessThan(5000)
        } finally {
          await srv.close()
        }
      }
    }, 30_000)
  }

  /**
   * TC-SEC-06 — chỉ `sse`: redirect cùng origin RỒI mở stream thật. Server giả
   * đếm số message đã đẩy xuống stream ⇒ chứng minh stream 🚫 đứt sau redirect.
   */
  test('TC-SEC-06 [sse]: redirect cùng origin rồi stream ≥2 sự kiện ⇒ 🚫 đứt', async () => {
    const srv = await startFakeMcpHttp({ mode: 'sse' })
    srv.plan = ({ pathname }) => (pathname === '/sse' ? { status: 302, location: '/sse/' } : null)
    try {
      const result = await probeMcpServer(remoteServer('sse', srv.url('/sse')), {
        listTools: true,
        timeoutMs: 8000,
      })

      expect(result.ok).toBe(true)
      expect(result.tools.map((t) => t.name).sort()).toEqual(['echo', 'ping'])
      expect(srv.sseMessages).toBeGreaterThanOrEqual(2)
    } finally {
      await srv.close()
    }
  }, 20_000)

  /**
   * TC-SEC-11 / TC-SEC-12 — ngữ nghĩa method + body qua redirect. Chỉ chạy ở
   * lượt `http`: `sse` mở stream bằng GET nên 🚫 có body nào để so.
   */
  test('TC-SEC-11 [http]: 307 cùng origin ⇒ hop 2 giữ POST và body byte-identical', async () => {
    const srv = await startFakeMcpHttp({ mode: 'http' })
    srv.plan = ({ pathname }) =>
      pathname === '/mcp' ? { status: 307, location: '/mcp-kept' } : null
    try {
      await probeMcpServer(remoteServer('http', srv.url('/mcp')), {
        listTools: true,
        timeoutMs: 8000,
      })

      const first = srv.hops.find((h) => h.path === '/mcp' && h.method === 'POST')
      const second = srv.hops.find((h) => h.path === '/mcp-kept')
      expect(first?.body).toBeTruthy()
      expect(second?.method).toBe('POST')
      expect(second?.body).toBe(first!.body)
    } finally {
      await srv.close()
    }
  }, 20_000)

  test('TC-SEC-12 [http]: 302/303 trên POST ⇒ hop 2 là GET và 🚫 có body', async () => {
    for (const status of [302, 303]) {
      const srv = await startFakeMcpHttp({ mode: 'http' })
      srv.plan = ({ pathname }) =>
        pathname === '/mcp' ? { status, location: '/mcp-downgraded' } : null
      try {
        await probeMcpServer(remoteServer('http', srv.url('/mcp')), {
          listTools: true,
          timeoutMs: 8000,
        })

        const second = srv.hops.find((h) => h.path === '/mcp-downgraded')
        expect(second, `status=${status}`).toBeDefined()
        expect(second?.method, `status=${status}`).toBe('GET')
        expect(second?.body, `status=${status}`).toBe('')
      } finally {
        await srv.close()
      }
    }
  }, 30_000)
})

/**
 * `openMcpSession` — phiên MCP sống theo JOB (#379, PR 4).
 *
 * Khác `probeMcpServer` (mở–đo–đóng trong một lần gọi): vòng đời do caller quản,
 * nên ca ở đây đo bằng **PID tiến trình con thật**. Quên `close()` là rò tiến
 * trình theo từng job — thứ chỉ spawn thật mới bắt được.
 */
describe('openMcpSession — phiên theo job', () => {
  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  async function waitDead(pid: number, ms = 5000): Promise<boolean> {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (!alive(pid)) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return !alive(pid)
  }

  /**
   * 📌 Chênh lệch CỐ Ý với `probeMcpServer`: probe để `inputSchema` trống (kết
   * quả probe chảy ra API + persist vào `lastCheck`, mà schema là payload lớn
   * 🚫 ai đọc ở đó), còn vòng tool-use BẮT BUỘC có nó để khai tool với SDK.
   * Hai vế assert trong CÙNG một ca để chênh lệch này 🚫 trôi.
   */
  test('openMcpSession điền `inputSchema`; `probeMcpServer` cố ý KHÔNG', async () => {
    const session = await openMcpSession(fakeServer('ok'), { timeoutMs: 15_000 })
    try {
      expect(session.tools.map((t) => t.name).sort()).toEqual(['echo', 'ping'])
      const echo = session.tools.find((t) => t.name === 'echo')!
      expect(echo.inputSchema).toBeTruthy()
      expect((echo.inputSchema as any).type).toBe('object')
      expect((echo.inputSchema as any).properties).toHaveProperty('text')
    } finally {
      await session.close()
    }

    const probed = await probeMcpServer(fakeServer('ok'), { listTools: true, timeoutMs: 15_000 })
    expect(probed.ok).toBe(true)
    expect(probed.tools.every((t) => t.inputSchema === undefined)).toBe(true)
  }, 30_000)

  test('`callTool` gọi được nhiều lần trên cùng phiên; `close()` idempotent', async () => {
    const session = await openMcpSession(fakeServer('ok'), { timeoutMs: 15_000 })

    expect(JSON.stringify(await session.callTool('echo', { text: 'lan-1' }))).toContain('lan-1')
    expect(JSON.stringify(await session.callTool('echo', { text: 'lan-2' }))).toContain('lan-2')

    await session.close()
    await expect(session.close()).resolves.toBeUndefined()
  }, 30_000)

  test('`close()` giết tiến trình con của transport stdio', async () => {
    const pidFile = pidFilePath()
    const session = await openMcpSession(fakeServer('ok', { env: { FAKE_MCP_PID_FILE: pidFile } }), {
      timeoutMs: 15_000,
    })
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))

    expect(alive(pid)).toBe(true)
    await session.close()
    expect(await waitDead(pid)).toBe(true)
  }, 30_000)

  /**
   * Mở HỤT: caller nhận exception và 🚫 có handle nào để gọi `close()`, nên
   * `openMcpSession` phải tự đóng tại chỗ — nếu không tiến trình con ở lại mãi.
   */
  test('mở hụt ⇒ tự đóng tại chỗ, 🚫 rò tiến trình con', async () => {
    const pidFile = pidFilePath()
    await expect(
      openMcpSession(fakeServer('init-then-hang', { env: { FAKE_MCP_PID_FILE: pidFile } }), {
        timeoutMs: 1200,
      }),
    ).rejects.toThrow()

    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    expect(await waitDead(pid)).toBe(true)
  }, 30_000)

  test('`onWarning` phát NGAY lúc dựng transport, kể cả khi `connect()` ném sau đó', async () => {
    const warnings: string[] = []
    await expect(
      openMcpSession(
        fakeServer('init-then-hang', { env: { TOKEN: 'env:BIEN_CHAC_CHAN_KHONG_TON_TAI_123' } }),
        { timeoutMs: 1200, onWarning: (m) => warnings.push(m) },
      ),
    ).rejects.toThrow()

    expect(warnings.join('\n')).toContain('BIEN_CHAC_CHAN_KHONG_TON_TAI_123')
  }, 30_000)
})
