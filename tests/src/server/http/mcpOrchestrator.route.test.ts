import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { mintMcpToken, revokeMcpTokensFor } from '../../../../src/features/orchestrator/business/mcpTokens.js'

/*
 * `/api/mcp/orchestrator` qua ĐÚNG giao thức Streamable HTTP — Client thật của
 * `@modelcontextprotocol/sdk`, nối qua `app.request` (Hono test client) thay vì
 * mở cổng TCP thật, cùng kiểu `fetch` tuỳ biến mà transport hỗ trợ sẵn. Đây là
 * bề mặt thật mà `claude` CLI thấy qua `--mcp-config type:http` (design §3.1).
 *
 * Hành vi TỪNG tool (status/read-output/decide) đã chấm ở
 * `tests/src/server/orchestrator/mcpTools.test.ts`. Ở đây chỉ chấm CỔNG VÀO:
 * route có mount đúng chỗ, JWT dashboard không chặn nhầm, và xác thực bằng
 * token theo job (TC-09/TC-10) — không phải JWT.
 */

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

function seedTask(taskId: string, state: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: 'implementer', ...state }),
    'utf8',
  )
}

/** Client thật của SDK, nối qua `app.request` — không cần mở cổng TCP. */
async function connect(token?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp/orchestrator'), {
    fetch: async (url: any, init: any) => app.request(url, init),
    requestInit: token ? { headers: { 'X-Dashboard-Orchestrator-Token': token } } : undefined,
  })
  const client = new Client({ name: 'test-orchestrator-agent', version: '1.0.0' })
  await client.connect(transport)
  return client
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})

describe('POST /api/mcp/orchestrator', () => {
  test('TC-09: không có token ⇒ 401, không lộ tool nào', async () => {
    app = await createApp(fakeCtx())
    await expect(connect(undefined)).rejects.toThrow()
  })

  test('TC-09: token sai/không tồn tại ⇒ 401', async () => {
    app = await createApp(fakeCtx())
    await expect(connect('token-khong-ton-tai')).rejects.toThrow(/invalid or expired/)
  })

  test('token hợp lệ ⇒ vào được, thấy đúng 3 tool và trạng thái thật của task', async () => {
    app = await createApp(fakeCtx())
    seedTask('R1', { current_phase: 'reviewer' })
    const token = mintMcpToken({ taskId: 'R1', root, projectId: '' })

    const client = await connect(token)
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((t) => t.name).sort()).toEqual([
        'orchestrator_decide',
        'orchestrator_read_output',
        'orchestrator_status',
      ])

      const res = await client.callTool({ name: 'orchestrator_status', arguments: {} })
      const body = JSON.parse((res.content as any)[0].text)
      expect(body.currentPhase).toBe('reviewer')
    } finally {
      await client.close()
    }
  })

  // TC-10 — token cấp cho MỘT lượt orchestrator hết hiệu lực khi lượt đó kết
  // thúc (job xong / bị dừng); dùng lại đúng token cũ không còn điều khiển được.
  test('TC-10: token bị thu hồi sau khi orchestrator kết thúc lượt ⇒ dùng lại bị từ chối', async () => {
    app = await createApp(fakeCtx())
    seedTask('R2')
    const ref = { taskId: 'R2', root, projectId: '' }
    const token = mintMcpToken(ref)

    // Xác nhận token còn dùng được trước khi thu hồi.
    const firstClient = await connect(token)
    await firstClient.close()

    revokeMcpTokensFor(ref)

    await expect(connect(token)).rejects.toThrow(/invalid or expired/)
  })

  test('token của task A không điều khiển được task B (TC-08, ở lớp xác thực)', async () => {
    app = await createApp(fakeCtx())
    seedTask('R3', { current_phase: 'implementer' })
    seedTask('R4', { current_phase: 'reviewer' })
    const tokenA = mintMcpToken({ taskId: 'R3', root, projectId: '' })

    const client = await connect(tokenA)
    try {
      const res = await client.callTool({ name: 'orchestrator_status', arguments: {} })
      const body = JSON.parse((res.content as any)[0].text)
      // Token của R3 luôn resolve về R3 — không có tham số nào để trỏ sang R4.
      expect(body.currentPhase).toBe('implementer')
    } finally {
      await client.close()
    }
  })
})
