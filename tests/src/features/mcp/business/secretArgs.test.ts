import { describe, expect, test } from 'bun:test'
import {
  MCP_MASK,
  MCP_WARN_ARGS_SECRET_DROPPED,
  collectSecretArgs,
  collectSecretValues,
  isMaskableSecret,
  maskArgs,
  maskSecretValues,
  mergeMaskedSecrets,
  type McpRemoteServer,
  type McpServerConfig,
  type McpStdioServer,
} from '../../../../../src/features/mcp/business/types.js'

/**
 * TC-SEC-16…TC-SEC-29 + TC-SEC-RT0 — secret literal trong `stdio.args` (#385, PR 1).
 *
 * Bề mặt: 4 hàm công khai của `mcp/business/types.ts` — `collectSecretArgs`,
 * `collectSecretValues`, `maskSecretValues`, `mergeMaskedSecrets`.
 *
 * Hai hàm cố ý KHÁC NGƯỠNG và TC phải khoá cả hai vế (TC-SEC-28):
 *   - `maskArgs` / `maskSecretValues` — đường **API**, 🚫 không lọc độ dài:
 *     thà che hụt độ dài còn hơn để lộ.
 *   - `collectSecretValues` — danh sách thay-chuỗi cho **log**, CÓ lọc
 *     `isMaskableSecret` (≥ 8 ký tự): thay một chuỗi ngắn vào log là hỏng log.
 *
 * Canary dùng chung một chuỗi duy nhất dễ `grep` (`test-spec.md` §2.3).
 */

const CANARY = 'sk-test-LEAKCANARY-0123456789'

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

describe('collectSecretArgs — nhận diện 3 dạng', () => {
  // TC-SEC-16
  test('TC-SEC-16: cờ đứng trước ⇒ đúng 1 hit, và giá trị vào collectSecretValues', () => {
    const args = ['--token', CANARY]
    expect(collectSecretArgs(args)).toEqual([{ index: 1, value: CANARY }])

    const server = stdio({ id: 'a', args })
    expect(collectSecretValues(server)).toContain(CANARY)
  })

  // TC-SEC-17 — ngưỡng 8 ký tự của `isMaskableSecret` 🚫 KHÔNG được áp cho `args`.
  test('TC-SEC-17: tên gói + đường dẫn dài ⇒ 0 hit, args giữ nguyên từng phần tử', () => {
    const args = [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/home/user/projects/agent-workflow/.dev-team-agent',
    ]
    expect(collectSecretArgs(args)).toEqual([])
    expect(maskSecretValues(stdio({ id: 'a', args })).args).toEqual(args)
  })

  // TC-SEC-18
  test('TC-SEC-18: cờ không-secret, và cờ secret bị bỏ trống ⇒ 0 hit', () => {
    expect(collectSecretArgs(['--port', '8080', '--verbose'])).toEqual([])
    // Giá trị bắt đầu bằng `-` sau cờ secret là cờ kế tiếp, 🚫 không phải secret.
    expect(collectSecretArgs(['--token', '--verbose'])).toEqual([])
  })

  // TC-SEC-19
  test('TC-SEC-19: dạng gộp `--flag=value` ⇒ 1 hit mang cả flag', () => {
    const value = 'ghp_LEAKCANARY0123456789'
    expect(collectSecretArgs([`--api-key=${value}`])).toEqual([
      { index: 0, value, flag: '--api-key' },
    ])
    expect(collectSecretValues(stdio({ id: 'a', args: [`--api-key=${value}`] }))).toContain(value)
  })

  // TC-SEC-20 — nhận theo HÌNH DẠNG giá trị, không cần cờ. Mỗi dạng một assert.
  test('TC-SEC-20: hình dạng token đã biết ⇒ 1 hit, không cần cờ đứng trước', () => {
    const shapes: Record<string, string> = {
      'sk-': 'sk-LEAKCANARY0123456789',
      ghp_: 'ghp_LEAKCANARY0123456789',
      'xoxb-': 'xoxb-LEAKCANARY-0123456789',
      AIza: 'AIzaLEAKCANARY0123456789',
      'ya29.': 'ya29.LEAKCANARY0123456789',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJMRUFLQ0FOQVJZIn0.sig',
    }
    for (const [name, value] of Object.entries(shapes)) {
      expect(collectSecretArgs([value]), `dạng ${name}`).toEqual([{ index: 0, value }])
    }
  })
})

describe('maskSecretValues — che `args` ở đường API', () => {
  // TC-SEC-21
  test('TC-SEC-21: cả 3 dạng cùng lúc; arg thường giữ nguyên vị trí; env vẫn mask', () => {
    const server = stdio({
      id: 'all-shapes',
      args: [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '--token',
        CANARY,
        '--api-key=ghp_LEAKCANARY0123456789',
        'xoxb-LEAKCANARY-0123456789',
        '--verbose',
      ],
      env: { MY_TOKEN: CANARY, VIA_REF: 'env:HOME_TOKEN' },
    })

    const masked = maskSecretValues(server)
    expect(masked.args).toEqual([
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '--token',
      MCP_MASK,
      `--api-key=${MCP_MASK}`,
      MCP_MASK,
      '--verbose',
    ])
    // Độ dài mảng 🚫 không đổi — che tại chỗ, không xoá phần tử.
    expect(masked.args).toHaveLength(server.args.length)
    // Chống hồi quy: `env` vẫn mask như cũ, `env:NAME` vẫn giữ để còn sửa được.
    expect(masked.env).toEqual({ MY_TOKEN: MCP_MASK, VIA_REF: 'env:HOME_TOKEN' })
    // Vế phủ định — quét toàn payload tìm canary.
    expect(JSON.stringify(masked)).not.toContain(CANARY)
    // Bản gốc 🚫 không bị sửa tại chỗ.
    expect(server.args[3]).toBe(CANARY)
  })

  // TC-SEC-29
  test('TC-SEC-29: `args` undefined / rỗng ⇒ 🚫 không ném, 🚫 không đổi hình dạng field', () => {
    expect(() => maskArgs(undefined)).not.toThrow()
    expect(maskArgs(undefined)).toEqual([])

    // Khoá `args` VẮNG HẲN trên input ⇒ phải vẫn vắng trên output.
    const bare = stdio({ id: 'no-args' }) as Partial<McpStdioServer>
    delete bare.args
    const maskedBare = maskSecretValues(bare as McpStdioServer)
    expect(maskedBare.args).toBeUndefined()
    expect('args' in maskedBare).toBe(false)

    // Khoá có mặt nhưng giá trị `undefined` ⇒ 🚫 không được hoá thành `[]`.
    const noArgs = { ...stdio({ id: 'no-args' }), args: undefined } as unknown as McpStdioServer
    expect(maskSecretValues(noArgs).args).toBeUndefined()

    expect(maskSecretValues(stdio({ id: 'empty', args: [] })).args).toEqual([])
  })
})

describe('collectSecretValues — danh sách mask của LOG (ngưỡng khác đường API)', () => {
  // TC-SEC-28 — hai vế phải cùng khoá, nếu không là mô tả nhầm một trong hai hàm.
  test('TC-SEC-28: secret < 8 ký tự ⇒ 🚫 không vào log-mask, nhưng `args` vẫn bị che', () => {
    const server = stdio({ id: 'short', args: ['--token', 'ab'] })

    expect(isMaskableSecret('ab')).toBe(false)
    expect(collectSecretValues(server)).not.toContain('ab')
    expect(collectSecretValues(server)).toEqual([])

    // Đường API thì ngược lại — che.
    expect(maskSecretValues(server).args).toEqual(['--token', MCP_MASK])
  })

  test('TC-SEC-28b: `env:NAME` là tên biến ⇒ 🚫 không vào danh sách mask', () => {
    const server = stdio({ id: 'ref', env: { TOKEN: 'env:MY_TOKEN' }, args: [] })
    expect(collectSecretValues(server)).toEqual([])
  })
})

describe('mergeMaskedSecrets — round-trip "lấy về → bấm Lưu"', () => {
  // TC-SEC-22
  test('TC-SEC-22: neo khớp (cờ đứng trước) ⇒ khôi phục đúng secret cũ', () => {
    const next = stdio({ id: 'a', args: ['--token', MCP_MASK] })
    const previous = stdio({ id: 'a', args: ['--token', CANARY] })
    expect(mergeMaskedSecrets(next, previous).args).toEqual(['--token', CANARY])
  })

  // TC-SEC-23 ⭐ — neo LỆCH ⇒ bỏ hẳn phần tử + có cảnh báo.
  test('TC-SEC-23: người dùng chèn 1 arg phía trước ⇒ ô `***` bị BỎ, có cảnh báo', () => {
    const next = stdio({ id: 'a', args: ['--extra', '--token', MCP_MASK] })
    const previous = stdio({ id: 'a', args: ['--token', CANARY] })
    const warnings: string[] = []

    const merged = mergeMaskedSecrets(next, previous, warnings)

    expect(merged.args).toEqual(['--extra', '--token'])
    expect(JSON.stringify(merged)).not.toContain(MCP_MASK)
    expect(JSON.stringify(merged)).not.toContain(CANARY)
    expect(warnings).toContain(MCP_WARN_ARGS_SECRET_DROPPED)
  })

  // TC-SEC-24
  test('TC-SEC-24: dạng gộp, neo khớp ⇒ khôi phục `--api-key=<real>`', () => {
    const next = stdio({ id: 'a', args: [`--api-key=${MCP_MASK}`] })
    const previous = stdio({ id: 'a', args: ['--api-key=ghp_real_0123456789'] })
    expect(mergeMaskedSecrets(next, previous).args).toEqual(['--api-key=ghp_real_0123456789'])
  })

  // TC-SEC-25
  test('TC-SEC-25: dạng gộp, neo LỆCH (cờ khác) ⇒ bỏ phần tử, 🚫 không còn `***`', () => {
    const next = stdio({ id: 'a', args: [`--api-key=${MCP_MASK}`] })
    const previous = stdio({ id: 'a', args: ['--token=ghp_real_0123456789'] })
    const warnings: string[] = []

    const merged = mergeMaskedSecrets(next, previous, warnings)

    expect(merged.args).toEqual([])
    expect(JSON.stringify(merged)).not.toContain(MCP_MASK)
    expect(warnings).toContain(MCP_WARN_ARGS_SECRET_DROPPED)
  })

  // TC-SEC-26
  test('TC-SEC-26: người dùng gõ giá trị MỚI ⇒ 🚫 không bị bản cũ ghi đè', () => {
    const next = stdio({ id: 'a', args: ['--token', 'sk-brand-new-9999999999'] })
    const previous = stdio({ id: 'a', args: ['--token', CANARY] })
    const merged = mergeMaskedSecrets(next, previous)

    expect(merged.args).toEqual(['--token', 'sk-brand-new-9999999999'])
    expect(JSON.stringify(merged)).not.toContain(CANARY)
  })

  /**
   * TC-SEC-27 ⭐ — bất biến chốt của SEC-7, chạy trên bộ fixture ≥ 6 server.
   * `mergeMaskedSecrets(maskSecretValues(s), s)` phải deep-equal `s`: đó đúng là
   * vòng *lấy về (đã mask) → bấm Lưu mà 🚫 sửa gì*.
   */
  test('TC-SEC-27: round-trip deep-equal trên 8 fixture', () => {
    const fixtures: McpServerConfig[] = [
      stdio({ id: 'stdio-no-secret', args: ['-y', '@modelcontextprotocol/server-filesystem'] }),
      stdio({ id: 'stdio-flag-secret', args: ['--token', CANARY] }),
      stdio({ id: 'stdio-inline-secret', args: ['--api-key=ghp_LEAKCANARY0123456789'] }),
      stdio({ id: 'stdio-shape-secret', args: ['-y', 'pkg', 'xoxb-LEAKCANARY-0123456789'] }),
      stdio({ id: 'stdio-empty-args', args: [] }),
      { ...stdio({ id: 'stdio-undef-args' }), args: undefined } as unknown as McpStdioServer,
      stdio({ id: 'stdio-env', env: { TOKEN: CANARY, REF: 'env:FOO' }, args: ['--verbose'] }),
      remote({ id: 'remote', headers: { 'X-API-Key': CANARY } }),
    ]

    expect(fixtures.length).toBeGreaterThanOrEqual(6)
    for (const fixture of fixtures) {
      const warnings: string[] = []
      const roundTripped = mergeMaskedSecrets(maskSecretValues(fixture), fixture, warnings)
      expect(roundTripped, `fixture ${fixture.id}`).toEqual(fixture)
      expect(warnings, `fixture ${fixture.id} 🚫 không được sinh cảnh báo`).toEqual([])
    }
  })

  /**
   * TC-SEC-RT0 (review vòng 1) — secret nhận theo HÌNH DẠNG ở `args[0]`. Vị trí 0
   * 🚫 không có cờ nào đứng trước để neo, nên nếu thiếu nhánh neo riêng thì token
   * bị bỏ sau mỗi vòng sửa-lưu.
   */
  test('TC-SEC-RT0: token ở args[0] round-trip deep-equal, 🚫 không bị bỏ', () => {
    const server = stdio({ id: 'gh', args: ['ghp_LEAKCANARY0123456789', '--repo', 'o/r'] })

    const masked = maskSecretValues(server)
    expect(masked.args).toEqual([MCP_MASK, '--repo', 'o/r'])

    const warnings: string[] = []
    const merged = mergeMaskedSecrets(masked, server, warnings)

    expect(merged).toEqual(server)
    expect(merged.args[0]).toBe('ghp_LEAKCANARY0123456789')
    expect(warnings).toEqual([])
  })

  test('TC-SEC-RT0b: sửa một arg KHÁC rồi lưu ⇒ token ở args[0] vẫn còn', () => {
    const server = stdio({ id: 'gh', args: ['ghp_LEAKCANARY0123456789', '--repo', 'o/r'] })
    const edited = { ...maskSecretValues(server), args: [MCP_MASK, '--repo', 'o/r2'] }

    expect(mergeMaskedSecrets(edited as McpStdioServer, server).args).toEqual([
      'ghp_LEAKCANARY0123456789',
      '--repo',
      'o/r2',
    ])
  })

  test('TC-SEC-RT0c: chèn arg phía trước ⇒ ô `***` trôi xuống i>0 và VẪN bị bỏ', () => {
    const server = stdio({ id: 'gh', args: ['ghp_LEAKCANARY0123456789', '--repo', 'o/r'] })
    const warnings: string[] = []
    const merged = mergeMaskedSecrets(
      { ...maskSecretValues(server), args: ['--new', MCP_MASK, '--repo', 'o/r'] } as McpStdioServer,
      server,
      warnings,
    )

    expect(JSON.stringify(merged)).not.toContain(MCP_MASK)
    expect(JSON.stringify(merged)).not.toContain('ghp_LEAKCANARY0123456789')
    expect(warnings).toContain(MCP_WARN_ARGS_SECRET_DROPPED)
  })
})
