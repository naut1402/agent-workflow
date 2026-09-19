import { afterEach, describe, expect, test } from 'bun:test'
import { serialiseMcpServers } from '../../../../../src/features/mcp/business/serialize.js'
import type {
  McpRemoteServer,
  McpServerConfig,
  McpStdioServer,
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
  // TC-19
  test('TC-19: entry stdio có ĐÚNG bốn khoá, 🚫 không có `cwd`; cwd lệch ⇒ 1 warning', () => {
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

  // TC-20
  test('TC-20: cwd không khai / rỗng / trùng workspace ⇒ 0 warning, vẫn đúng bốn khoá', () => {
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
