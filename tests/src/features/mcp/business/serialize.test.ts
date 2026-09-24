import { afterEach, describe, expect, test } from 'bun:test'
import { serialiseMcpServers } from '../../../../../src/features/mcp/business/serialize.js'
import {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_TIMEOUT_MS,
  MCP_MIN_TIMEOUT_MS,
  type McpRemoteServer,
  type McpServerConfig,
  type McpStdioServer,
} from '../../../../../src/features/mcp/business/types.js'

/**
 * TC-19…TC-27 — serializer sinh nội dung `mcpServers` cho `--mcp-config`.
 *
 * Shape khoá là contract của BÊN THỨ BA, không phải quy ước nội bộ: bằng chứng
 * thực nghiệm trên Claude Code 2.1.267 ở `mcp-contract-verification.md`
 * (test-spec §6.5). Ba điểm đã chốt và được assert thẳng ở đây:
 *   - `type` của HTTP streamable là `http` (`streamable-http` chỉ là bí danh);
 *   - entry có `url` BẮT BUỘC khai `type`; entry stdio khai tường minh vẫn hợp lệ;
 *   - 🚫 KHÔNG có khoá `cwd` — CLI nuốt im lặng, nên nó chỉ sinh `warnings`.
 */

const CANARY = 'sk-CANARY-0123456789'

function stdio(over: Partial<McpStdioServer> & { id: string }): McpStdioServer {
  return {
    label: over.id,
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: [],
    env: {},
    ...over,
  } as McpStdioServer
}

function remote(over: Partial<McpRemoteServer> & { id: string }): McpRemoteServer {
  return {
    label: over.id,
    enabled: true,
    transport: 'http',
    url: 'https://api.example.com/mcp',
    headers: {},
    ...over,
  } as McpRemoteServer
}

const prevEnv = { ...process.env }
afterEach(() => {
  for (const key of ['MY_TOKEN', 'MCP_TEST_TOKEN']) {
    if (prevEnv[key] === undefined) delete process.env[key]
    else process.env[key] = prevEnv[key]
  }
})

describe('serialiseMcpServers — stdio', () => {
  /**
   * TC-19 — ⚠️ ĐIỀU KIỆN của ca này, 🚫 KHÔNG phải bất biến của entry stdio:
   * `stdio()` 🚫 không set `timeoutMs`, và chỉ vì vậy entry mới có đúng bốn khoá.
   * Server CÓ khai timeout thì entry có khoá thứ năm `startupTimeoutSec` (TC-C02).
   *
   * 🚫 Đừng đọc ca này là «đường UI cũng cho bốn khoá»: `buildDraft()` của dialog
   * LUÔN ghi `timeoutMs`, nên mọi server lưu qua giao diện đều có khoá thứ năm.
   * Ca «không khai timeout» chỉ tới được bằng file store sửa tay hoặc migrate v1→v2.
   */
  test('TC-19: stdio KHÔNG khai timeout ⇒ đúng bốn khoá, 🚫 không có `cwd`; cwd lệch ⇒ 1 warning', () => {
    const result = serialiseMcpServers(
      [
        stdio({
          id: 'playwright',
          command: 'npx',
          args: ['-y', '@playwright/mcp@latest'],
          env: { FOO: 'bar' },
          cwd: '/srv/work',
        }),
      ],
      { workspace: '/ws' },
    )

    const entry = result.json.mcpServers.playwright as Record<string, unknown>
    expect(Object.keys(entry)).toEqual(['type', 'command', 'args', 'env'])
    expect(entry).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: { FOO: 'bar' },
    })
    expect(entry).not.toHaveProperty('cwd')

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('playwright')
    expect(result.warnings[0]).toContain('/ws')
  })

  // TC-20 — cùng điều kiện «không khai timeout» như TC-19.
  test('TC-20: cwd không khai / rỗng / trùng workspace ⇒ 0 warning, vẫn đúng bốn khoá (🚫 không có timeoutMs)', () => {
    const cases: (Partial<McpStdioServer>)[] = [{}, { cwd: '' }, { cwd: '/ws' }]
    for (const over of cases) {
      const result = serialiseMcpServers(
        [stdio({ id: 'playwright', args: ['-y', 'pkg'], env: { FOO: 'bar' }, ...over })],
        { workspace: '/ws' },
      )
      const entry = result.json.mcpServers.playwright as Record<string, unknown>
      expect(Object.keys(entry)).toEqual(['type', 'command', 'args', 'env'])
      expect(entry).not.toHaveProperty('cwd')
      expect(result.warnings).toEqual([])
    }
  })
})

describe('serialiseMcpServers — http / sse', () => {
  // TC-21
  test('TC-21: shape remote + header auth dựng từ `secretFor`', () => {
    for (const transport of ['http', 'sse'] as const) {
      const result = serialiseMcpServers(
        [
          remote({
            id: 'gh',
            transport,
            url: 'https://api.example.com/mcp',
            credentialId: 'cred-1',
            authHeader: 'Authorization',
            authScheme: 'Bearer',
            headers: { 'X-Trace': 'abc' },
          }),
        ],
        { workspace: '/ws', secretFor: (id) => (id === 'cred-1' ? CANARY : null) },
      )

      const entry = result.json.mcpServers.gh as any
      expect(entry.type).toBe(transport)
      expect(entry.url).toBe('https://api.example.com/mcp')
      expect(entry.headers.Authorization).toBe(`Bearer ${CANARY}`)
      expect(entry.headers['X-Trace']).toBe('abc')
      expect(result.secrets).toContain(CANARY)
      expect(result.warnings).toEqual([])
    }
  })

  /**
   * TC-22 — `authScheme` rỗng.
   *
   * ⚠️ Lệch so với expected ghi trong `test-spec.md`: spec kỳ vọng header bằng
   * ĐÚNG secret (không tiền tố). `design.md` §4.2 (dòng 280) chốt ngược lại —
   * `<authScheme || 'Bearer'> <secret>` — và hiện thực (`resolveRefs.ts:48`)
   * theo design. Ca này khoá theo design, và vẫn assert nguyên hai bất biến mà
   * spec thực sự nhắm tới: 🚫 không khoảng trắng thừa ở đầu, 🚫 không có chuỗi
   * `undefined`. Chi tiết ở `test-result.md`.
   */
  test('TC-22: authScheme rỗng ⇒ fallback `Bearer`, 🚫 không space thừa / `undefined`', () => {
    const result = serialiseMcpServers(
      [
        remote({
          id: 'gh',
          credentialId: 'cred-1',
          authHeader: 'Authorization',
          authScheme: '',
          headers: {},
        }),
      ],
      { workspace: '/ws', secretFor: () => CANARY },
    )

    const value = (result.json.mcpServers.gh as any).headers.Authorization as string
    expect(value).toBe(`Bearer ${CANARY}`)
    expect(value.startsWith(' ')).toBe(false)
    expect(value).not.toContain('undefined')
  })

  // TC-25
  test('TC-25: credential không resolve được ⇒ bỏ hẳn header auth + warning không mang secret', () => {
    const result = serialiseMcpServers(
      [
        remote({
          id: 'gh',
          credentialId: 'cred-missing',
          authHeader: 'Authorization',
          headers: { 'X-Trace': 'abc' },
        }),
      ],
      { workspace: '/ws', secretFor: () => null },
    )

    const entry = result.json.mcpServers.gh as any
    expect(entry.headers).not.toHaveProperty('Authorization')
    expect(JSON.stringify(entry)).not.toContain('Bearer')
    expect(entry.headers['X-Trace']).toBe('abc')
    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    expect(result.warnings.join('\n')).not.toContain(CANARY)
  })
})

describe('serialiseMcpServers — tham chiếu env:', () => {
  // TC-23
  test('TC-23: `env:` trỏ biến không tồn tại ⇒ bỏ khoá + warning, 🚫 không ghi literal', () => {
    delete process.env.MY_TOKEN
    const result = serialiseMcpServers(
      [stdio({ id: 'playwright', env: { TOKEN: 'env:MY_TOKEN', KEEP: 'plain' } })],
      { workspace: '/ws' },
    )

    const entry = result.json.mcpServers.playwright as any
    expect(entry.env).not.toHaveProperty('TOKEN')
    expect(entry.env.KEEP).toBe('plain')
    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    expect(result.warnings.join('\n')).toContain('MY_TOKEN')
    expect(JSON.stringify(result.json)).not.toContain('env:MY_TOKEN')
  })

  // TC-24
  test('TC-24: `env:` trỏ biến có tồn tại ⇒ resolve và vào danh sách mask', () => {
    process.env.MY_TOKEN = 'sk-CANARY-9'
    const result = serialiseMcpServers([stdio({ id: 'playwright', env: { TOKEN: 'env:MY_TOKEN' } })], {
      workspace: '/ws',
    })

    const entry = result.json.mcpServers.playwright as any
    expect(entry.env.TOKEN).toBe('sk-CANARY-9')
    expect(result.secrets).toContain('sk-CANARY-9')
    expect(result.warnings).toEqual([])
  })
})

describe('serialiseMcpServers — khoá và danh sách rỗng', () => {
  // TC-26
  test('TC-26: khoá của `mcpServers` là id đã sanitise', () => {
    const servers: McpServerConfig[] = [
      stdio({ id: 'ok-1' }),
      // Id chứa `/` — `sanitiseMcpServerId` từ chối (TC-07 nhóm A).
      stdio({ id: '../../etc/passwd' }),
    ]
    const result = serialiseMcpServers(servers, { workspace: '/ws' })

    const keys = Object.keys(result.json.mcpServers)
    expect(keys).toContain('ok-1')
    for (const key of keys) {
      expect(key).not.toContain('/')
      expect(key).not.toContain('\\')
      expect(key).not.toContain('\0')
      expect(key).not.toContain('..')
    }
  })

  // TC-27
  test('TC-27: danh sách rỗng ⇒ `{ mcpServers: {} }`, không ném', () => {
    const result = serialiseMcpServers([], { workspace: '/ws' })
    expect(result.json).toEqual({ mcpServers: {} })
    expect(result.secrets).toEqual([])
    expect(result.warnings).toEqual([])
  })
})

/* ─── Tdad47b2b · nhóm C — khoá timeout khởi động của entry stdio ─────────── */

/**
 * TC-C01…TC-C11 — `startupTimeoutSec`.
 *
 * Miền `[5, 600]` giây và mặc định 120s là hợp đồng của Claude Code CLI
 * (`z.coerce.number().int().min(5).max(600).optional()`, `default: 120`, chỉ hiện
 * với `transport === 'stdio'` — đã đọc lại schema trên bản 2.1.267). Mọi ca dưới
 * đây chỉ chốt **đầu ra của dashboard**, 🚫 không chốt hành vi của CLI.
 *
 * Sàn/trần lấy từ hằng dùng chung, 🚫 không chép số vào assert — lệch hợp đồng
 * thì `types.ts` là chỗ duy nhất phải sửa.
 */
const MIN_SEC = MCP_MIN_TIMEOUT_MS / 1000
const MAX_SEC = MCP_MAX_TIMEOUT_MS / 1000
const KEY = 'startupTimeoutSec'

function entryFor(timeoutMs: number | undefined, id = 'playwright') {
  const result = serialiseMcpServers([stdio({ id, timeoutMs })], { workspace: '/ws' })
  return { entry: result.json.mcpServers[id] as Record<string, unknown>, warnings: result.warnings }
}

describe('serialiseMcpServers — timeout khởi động (nhóm C)', () => {
  // TC-C01
  test('TC-C01: 🚫 không khai timeout ⇒ 🚫 không có khoá timeout khởi động, 0 warning', () => {
    const { entry, warnings } = entryFor(undefined)
    expect(Object.keys(entry)).toEqual(['type', 'command', 'args', 'env'])
    expect(entry).not.toHaveProperty(KEY)
    expect(warnings).toEqual([])
  })

  // TC-C02
  test('TC-C02: mặc định mới 120000 ⇒ NĂM khoá, giá trị 120 giây, 0 warning', () => {
    const { entry, warnings } = entryFor(MCP_DEFAULT_TIMEOUT_MS)
    expect(Object.keys(entry)).toHaveLength(5)
    expect(entry[KEY]).toBe(MCP_DEFAULT_TIMEOUT_MS / 1000)
    expect(warnings).toEqual([])
  })

  // TC-C03
  test('TC-C03: dưới sàn ⇒ kẹp về sàn, ĐÚNG 1 warning nêu id và miền', () => {
    const { entry, warnings } = entryFor(1000)
    expect(entry[KEY]).toBe(MIN_SEC)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('playwright')
    expect(warnings[0]).toContain(`[${MIN_SEC}s, ${MAX_SEC}s]`)
  })

  // TC-C04
  test('TC-C04: trên trần ⇒ kẹp về trần, ĐÚNG 1 warning tương tự', () => {
    const { entry, warnings } = entryFor(900_000)
    expect(entry[KEY]).toBe(MAX_SEC)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('playwright')
    expect(warnings[0]).toContain(`[${MIN_SEC}s, ${MAX_SEC}s]`)
  })

  // TC-C05 — đúng biên 🚫 không phải vi phạm.
  test('TC-C05: đúng biên trong miền ⇒ giá trị tương ứng, 0 warning', () => {
    for (const [ms, sec] of [[MCP_MIN_TIMEOUT_MS, MIN_SEC], [MCP_MAX_TIMEOUT_MS, MAX_SEC]] as const) {
      const { entry, warnings } = entryFor(ms)
      expect(entry[KEY]).toBe(sec)
      expect(warnings).toEqual([])
    }
  })

  /**
   * TC-C06 — sát biên NGOÀI.
   *
   * Miền được kiểm trên giá trị **ms gốc**, 🚫 không trên giá trị đã làm tròn:
   * 4999ms làm tròn ra đúng 5s, nhưng nó vẫn là dưới sàn thật ⇒ phải có warning.
   */
  test('TC-C06: 4999 / 600001 ⇒ kẹp về biên, mỗi lần 1 warning «ngoài miền»', () => {
    for (const [ms, sec] of [[MCP_MIN_TIMEOUT_MS - 1, MIN_SEC], [MCP_MAX_TIMEOUT_MS + 1, MAX_SEC]] as const) {
      const { entry, warnings } = entryFor(ms)
      expect(entry[KEY]).toBe(sec)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(`[${MIN_SEC}s, ${MAX_SEC}s]`)
    }
  })

  // TC-C07
  test('TC-C07: giá trị không dùng được ⇒ 🚫 không ghi khoá, 🚫 không ném, 🚫 không `null`/`NaN`', () => {
    const bad = [0, -1, -60_000, Number.NaN, '' as unknown as number, undefined]
    for (const timeoutMs of bad) {
      const { entry } = entryFor(timeoutMs)
      expect(entry).not.toHaveProperty(KEY)
      const raw = JSON.stringify(entry)
      expect(raw).not.toContain('null')
      expect(raw).not.toContain('NaN')
    }
  })

  /**
   * TC-C08 — entry REMOTE 🚫 không có khoá timeout khởi động.
   *
   * Chốt theo `design.md` §6: task này 🚫 không ghi khoá đó cho nhánh remote —
   * schema CLI gắn nó sau predicate `transport === 'stdio'`, và shape entry remote
   * là contract của bên thứ ba.
   */
  test('TC-C08: entry remote có timeoutMs ⇒ 🚫 không có khoá đó, shape giữ `type`/`url`/`headers`', () => {
    for (const transport of ['http', 'sse'] as const) {
      const result = serialiseMcpServers(
        [remote({ id: 'gh', transport, timeoutMs: MCP_DEFAULT_TIMEOUT_MS })],
        { workspace: '/ws' },
      )
      const entry = result.json.mcpServers.gh as Record<string, unknown>
      expect(entry).not.toHaveProperty(KEY)
      expect(Object.keys(entry)).toEqual(['type', 'url', 'headers'])
      expect(result.warnings).toEqual([])
    }
  })

  /**
   * TC-C09 — giá trị không tròn giây.
   *
   * Chốt: CÓ warning, và thông điệp phải mô tả ĐÚNG nguyên nhân (làm tròn).
   * 7,5s nằm TRONG miền nên nói «ngoài miền [5s, 600s]» là khai sai nguyên nhân.
   */
  test('TC-C09: 7500 ⇒ số nguyên giây + warning mô tả việc làm tròn, 🚫 không nói «ngoài miền»', () => {
    const { entry, warnings } = entryFor(7500)

    expect(entry[KEY]).toBe(8)
    expect(Number.isInteger(entry[KEY])).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/làm tròn/i)
    expect(warnings[0]).toContain('8')
    expect(warnings[0]).not.toContain(`[${MIN_SEC}s, ${MAX_SEC}s]`)
  })

  // TC-C10
  test('TC-C10: 3 server (hợp lệ / dưới sàn / trên trần) ⇒ đúng 2 warning, mỗi cái trỏ đúng id', () => {
    const result = serialiseMcpServers(
      [
        stdio({ id: 'ok', timeoutMs: MCP_DEFAULT_TIMEOUT_MS }),
        stdio({ id: 'thap', timeoutMs: 1000 }),
        stdio({ id: 'cao', timeoutMs: 900_000 }),
      ],
      { workspace: '/ws' },
    )

    expect(result.warnings).toHaveLength(2)
    expect(result.warnings.filter((w) => w.startsWith('thap:'))).toHaveLength(1)
    expect(result.warnings.filter((w) => w.startsWith('cao:'))).toHaveLength(1)
    expect(result.warnings.some((w) => w.startsWith('ok:'))).toBe(false)
  })

  // TC-C11 — bất biến chung: mọi giá trị ghi ra đều hợp lệ với hợp đồng CLI.
  test('TC-C11: có khoá ⇒ luôn là số nguyên thuộc miền của CLI', () => {
    const inputs = [
      undefined, 0, -1, Number.NaN,
      1, 1000, MCP_MIN_TIMEOUT_MS - 1, MCP_MIN_TIMEOUT_MS, 7500, 30_000,
      MCP_DEFAULT_TIMEOUT_MS, 300_000, MCP_MAX_TIMEOUT_MS, MCP_MAX_TIMEOUT_MS + 1, 900_000,
      Number.MAX_SAFE_INTEGER,
    ]
    for (const timeoutMs of inputs) {
      const { entry } = entryFor(timeoutMs as number)
      if (!(KEY in entry)) continue
      const sec = entry[KEY] as number
      expect(Number.isInteger(sec)).toBe(true)
      expect(sec).toBeGreaterThanOrEqual(MIN_SEC)
      expect(sec).toBeLessThanOrEqual(MAX_SEC)
    }
  })

  /**
   * TC-C12 — phần còn lại của file 🚫 không đổi. Cách ghi `env`, chuẩn hoá khoá
   * server và warning về `cwd` được TC-19 / TC-23 / TC-24 / TC-26 khoá; ca này
   * chốt rằng thêm khoá timeout 🚫 không xê dịch chúng khi đi CÙNG nhau.
   */
  test('TC-C12: env + cwd + khoá cần chuẩn hoá đi cùng timeout ⇒ mọi hành vi cũ giữ nguyên', () => {
    process.env.MCP_TEST_TOKEN = 'sk-CANARY-12345'
    const result = serialiseMcpServers(
      [
        stdio({
          id: 'playwright',
          env: { FOO: 'bar', TOKEN: 'env:MCP_TEST_TOKEN' },
          cwd: '/srv/work',
          timeoutMs: 30_000,
        }),
      ],
      { workspace: '/ws' },
    )

    const entry = result.json.mcpServers.playwright as any
    expect(entry.env).toEqual({ FOO: 'bar', TOKEN: 'sk-CANARY-12345' })
    expect(entry).not.toHaveProperty('cwd')
    expect(entry[KEY]).toBe(30)
    expect(result.secrets).toContain('sk-CANARY-12345')
    // Warning `cwd` vẫn còn và vẫn là warning DUY NHẤT (30000ms tròn giây, trong miền).
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('cwd')
  })
})
