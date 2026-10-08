// Tf2f484e2 · TC-D07 — SMOKE: entry MCP dashboard tự gắn có CHẠY ĐƯỢC THẬT.
//
// ⚠️ Đây là ca DUY NHẤT chứng minh mệnh đề "KẾT NỐI ĐƯỢC tới MCP" của
// `request.md` thay vì dự đoán nó. Mọi ca khác của nhóm A/B/D đều có giả lập ở
// đâu đó: toàn bộ chuỗi có thể xanh trong khi entry tự gắn không spawn nổi
// (chọn sai runtime cho một entrypoint TypeScript, thiếu quyền, thiếu file).
//
// Ca chậm (spawn tiến trình thật, mỗi lượt vài giây) nên đặt ở file riêng.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { buildSelfMcpEntry } from '../../src/features/runner/business/providers/selfMcpConfig.js'

const TOKEN = 'orch-token-smoke'
const BASE_URL = 'http://127.0.0.1:59124'

const ISOLATED = ['DEVTEAM_MCP_MODE', 'DASHBOARD_ORCHESTRATOR_TOKEN', 'DASHBOARD_ORCHESTRATOR_BASE_URL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ISOLATED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})
afterEach(() => {
  for (const key of ISOLATED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

/**
 * Nói chuyện MCP qua stdio với ĐÚNG `command`/`args`/`env` trong file khai.
 *
 * `inheritedMode` mô phỏng env của tiến trình cha (dashboard → `claude` → MCP).
 * `applyEntryEnv: false` mô phỏng trường hợp xấu nhất: CLI bên thứ ba KHÔNG để
 * `env` của entry thắng env kế thừa — đúng điều `test-spec.md` §6 nói không
 * chốt được bằng đọc code.
 */
async function withSelfEntry<T>(
  opts: { inheritedMode?: string; applyEntryEnv?: boolean },
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const entry = buildSelfMcpEntry({ orchestratorToken: TOKEN, baseUrl: BASE_URL })!
  expect(entry).toBeTruthy()

  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  if (opts.inheritedMode !== undefined) env.DEVTEAM_MCP_MODE = opts.inheritedMode
  if (opts.applyEntryEnv !== false) Object.assign(env, entry.env)

  const transport = new StdioClientTransport({
    command: entry.command,
    args: [...entry.args],
    env,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'self-mcp-smoke', version: '1.0.0' })
  await client.connect(transport)
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

describe('TC-D07: entry tự gắn spawn được và lộ đúng tool điều phối', () => {
  test('initialize + tools/list qua stdio ⇒ có orchestrator_decide', async () => {
    await withSelfEntry({}, async (client) => {
      const names = (await client.listTools()).tools.map((t) => t.name).sort()
      expect(names).toContain('orchestrator_decide')
      // Mode `full` ⇒ đủ 12 tool, không chỉ riêng tool điều phối.
      expect(names).toHaveLength(12)
      // `instructions` của chính phiên này phải dạy gọi tool, không dạy in JSON.
      expect(String(client.getInstructions() ?? '')).toContain('`orchestrator_decide` —')
    })
  }, 60_000)

  /**
   * ⚠️ Bất biến đắt nhất của tuyến `mcp` (`test-spec.md` §6, điểm thứ ba).
   *
   * `--mode=full` nằm trên ARGV chứ không chỉ trong `env` của entry, vì
   * `resolveMode` đọc argv TRƯỚC env. Nếu CLI không để `env` của entry thắng env
   * kế thừa mà ta lại chỉ dựa vào `env`, tool `orchestrator_decide` biến khỏi
   * `tools/list` và tuyến `mcp` hỏng TRONG IM LẶNG: prompt dạy gọi một tool
   * không tồn tại.
   */
  test('env kế thừa `readonly` và entry env BỊ BỎ QUA ⇒ argv vẫn thắng, tool còn nguyên', async () => {
    await withSelfEntry({ inheritedMode: 'readonly', applyEntryEnv: false }, async (client) => {
      const names = (await client.listTools()).tools.map((t) => t.name)
      expect(names).toContain('orchestrator_decide')
    })
  }, 60_000)

  test('env kế thừa `readonly` + entry env áp vào (hành vi CLI thật) ⇒ vẫn full', async () => {
    await withSelfEntry({ inheritedMode: 'readonly' }, async (client) => {
      const names = (await client.listTools()).tools.map((t) => t.name)
      expect(names).toContain('orchestrator_decide')
    })
  }, 60_000)

  test('tiến trình nhận được token/base URL của lượt ⇒ tool không rơi vào nhánh "thiếu env"', async () => {
    await withSelfEntry({}, async (client) => {
      await client.listTools()
      // Dashboard KHÔNG chạy ở địa chỉ này, nên lượt gọi phải hỏng ở tầng MẠNG
      // chứ 🚫 không phải ở nhánh "tiến trình này không gắn với lượt điều phối
      // nào" — đó là cách phân biệt env đã tới nơi hay chưa.
      const res: any = await client.callTool({
        name: 'orchestrator_decide',
        arguments: { action: 'halt', reason: 'smoke' },
      })
      expect(res.isError).toBe(true)
      expect(res._meta?.error?.code).toBe('internal')
      expect(String(res.content[0].text)).toContain('không gọi được dashboard')
      expect(String(res.content[0].text)).not.toContain('thiếu DASHBOARD_ORCHESTRATOR_TOKEN')
    })
  }, 60_000)
})
