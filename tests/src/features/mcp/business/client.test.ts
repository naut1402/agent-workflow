import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeMcpServer } from '../../../../../src/features/mcp/business/client.js'
import type { McpStdioServer } from '../../../../../src/features/mcp/business/types.js'

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
