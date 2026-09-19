import { afterEach, describe, expect, test } from 'bun:test'
import { assertMcpEndpoint } from '../../../../../src/features/mcp/business/endpointGuard.js'
import { fetchUrlSafe, isPrivateHostname } from '../../../../../src/features/agent-editor/business/index.js'

/**
 * TC-11…TC-18 — chốt URL riêng của MCP (`assertMcpEndpoint`).
 *
 * "Chặn" = ném; "cho phép" = không ném. Biên private lấy từ RFC 1918, không phải
 * danh sách nội bộ, nên assert thẳng theo giao thức.
 */

function allow(url: string) {
  expect(() => assertMcpEndpoint(url)).not.toThrow()
}
function block(url: unknown) {
  expect(() => assertMcpEndpoint(url)).toThrow()
}

describe('assertMcpEndpoint — cho phép', () => {
  // TC-11
  test('TC-11: https mọi host', () => {
    for (const url of [
      'https://example.com/mcp',
      'https://api.githubcopilot.com/mcp/',
      'https://127.0.0.1:8931/mcp',
      'https://[::1]/mcp',
      'https://localhost:3000/sse',
    ]) {
      allow(url)
    }
  })

  // TC-12 — ca dùng chính: playwright/serena chạy cục bộ trên http.
  test('TC-12: http loopback', () => {
    for (const url of [
      'http://127.0.0.1:8931/mcp',
      'http://[::1]:8931/mcp',
      'http://localhost:3000/mcp',
      'http://127.0.0.2/mcp',
    ]) {
      allow(url)
    }
  })

  // TC-13
  test('TC-13: http dải private', () => {
    for (const url of [
      'http://10.0.0.1/mcp',
      'http://192.168.1.5:3000/mcp',
      'http://172.16.0.1/mcp',
      'http://172.31.255.254/mcp',
      'http://my-box.local/mcp',
    ]) {
      allow(url)
    }
  })
})

describe('assertMcpEndpoint — biên và chặn', () => {
  // TC-14
  test('TC-14: biên của dải private theo RFC 1918', () => {
    block('http://172.15.0.1/mcp')
    allow('http://172.16.0.0/mcp')
    allow('http://172.31.255.255/mcp')
    block('http://172.32.0.1/mcp')
    block('http://11.0.0.1/mcp')
    block('http://192.167.1.1/mcp')
  })

  // TC-15
  test('TC-15: http host công cộng ⇒ chặn, thông điệp nêu lý do', () => {
    for (const url of [
      'http://example.com/mcp',
      'http://evil.com/mcp',
      'http://8.8.8.8/mcp',
      // Suffix attack: host thật là `attacker.io`, không phải `example.com`.
      'http://example.com.attacker.io/mcp',
    ]) {
      expect(() => assertMcpEndpoint(url)).toThrow(/loopback|private|cục bộ/i)
    }
  })

  // TC-16 — `ws`/`wss` bị chặn là CỐ Ý (design §6: WebSocket ngoài scope).
  test('TC-16: scheme khác ⇒ chặn', () => {
    for (const url of [
      'ws://127.0.0.1/mcp',
      'wss://example.com/mcp',
      'file:///etc/passwd',
      'ftp://example.com',
      'javascript:alert(1)',
      'data:text/plain,x',
    ]) {
      block(url)
    }
  })

  // TC-17
  test('TC-17: URL rác hoặc kiểu sai ⇒ chặn, luôn có thông điệp đọc được', () => {
    const junk: unknown[] = ['', '   ', 'not a url', 'http://', '://x', 'http:// 127.0.0.1/mcp', null, undefined, 123, {}]
    for (const value of junk) {
      let caught: unknown
      try {
        assertMcpEndpoint(value)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(Error)
      expect(String((caught as Error).message).trim().length).toBeGreaterThan(0)
    }
  })
})

describe('TC-18: guard mới không đụng fetchUrlSafe', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('TC-18: fetchUrlSafe vẫn từ chối loopback (http và https), D1/B3 không nới', async () => {
    // Trước task này `fetchUrlSafe` đã chặn cả hai — bất biến phải còn nguyên,
    // kể cả khi `assertMcpEndpoint` cho phép chính các URL đó (TC-12).
    await expect(fetchUrlSafe('http://127.0.0.1')).rejects.toThrow(/https/i)
    await expect(fetchUrlSafe('https://127.0.0.1')).rejects.toThrow(/private/i)
    expect(isPrivateHostname('127.0.0.1')).toBe(true)
    expect(isPrivateHostname('example.com')).toBe(false)
  })

  test('TC-18: host công cộng https vẫn đi qua fetchUrlSafe như cũ', async () => {
    // 🚫 Không gọi mạng thật (test-spec §1.4): thay `fetch` — đây là phụ thuộc
    // ngoài đã hợp lý để mock, không phải mock để né bug.
    let requested = ''
    globalThis.fetch = (async (input: any) => {
      requested = String(input)
      return new Response('ok', { status: 200 })
    }) as typeof fetch

    await expect(fetchUrlSafe('https://example.com')).resolves.toBe('ok')
    expect(requested).toBe('https://example.com')
  })
})
