import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'

// T6fabee9b · nhóm E của test-spec — hợp đồng HTTP của hai thay đổi:
//
// 1. 409 (🚫 không phải 400) khi dialog "tạo mới" gửi một id đã có người dùng.
//    Controller trước đây ép mọi `error` về `badRequest`, nên FE không phân biệt
//    được "payload sai" với "id trùng" và chỉ còn cách so chuỗi tiếng Việt.
// 2. `GET /api/runners` nói thêm runner nào job KHÔNG pin sẽ **thật sự** chạy
//    (`effectiveDefaultRunnerId`) và vì sao default hỏng (`defaultRunnerIssue`).
//
// Khuôn theo `connections.route.test.ts`: `createApp` + `app.request`, home tạm.

let root: string
let home: string
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

function postJson(url: string, body: unknown) {
  return app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Runner dùng được: connection seed mặc định trỏ `claude-code-cli` (họ agent-cli). */
const USABLE_CONNECTION = 'claude-code-cli-local'

async function seedRunner(id: string, extra: Record<string, unknown> = {}) {
  const res = await postJson('/api/runners', {
    runner: { id, name: id, connectionId: USABLE_CONNECTION, enabled: true, ...extra },
  })
  expect(res.status).toBe(200)
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-runners-route-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(home, { recursive: true })
  app = await createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  for (const f of ['runners.json', 'connections.json', 'credentials.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
})

describe('POST /api/runners — cờ create', () => {
  test('TC-D16: id trùng + create:true ⇒ HTTP 409 nêu id, 🚫 không phải 400', async () => {
    await seedRunner('claude')

    const res = await postJson('/api/runners', {
      runner: { id: 'claude', name: 'Claude 2', connectionId: USABLE_CONNECTION, create: true },
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('claude')
    expect(body.error).toContain('đã tồn tại')
  })

  test('TC-D33: id trùng KHÔNG kèm create ⇒ vẫn 200 { saved: true } (hợp đồng cũ không vỡ)', async () => {
    await seedRunner('claude')

    const res = await postJson('/api/runners', {
      runner: { id: 'claude', name: 'Claude đổi tên', connectionId: USABLE_CONNECTION },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.saved).toBe(true)
    expect(body.runner.name).toBe('Claude đổi tên')
  })
})

describe('POST /api/connections — cờ create', () => {
  test('TC-D17: id trùng + create:true ⇒ 409, connection cũ trên đĩa nguyên vẹn', async () => {
    const seed = await postJson('/api/connections', {
      connection: {
        id: 'claude-api',
        label: 'claude',
        kind: 'ai-provider',
        providerId: 'anthropic-api',
        credentialId: 'claude-default',
        config: { model: 'claude-cu' },
      },
    })
    expect(seed.status).toBe(200)

    const res = await postJson('/api/connections', {
      connection: {
        id: 'claude-api',
        label: 'Claude',
        kind: 'ai-provider',
        providerId: 'openai-api',
        credentialId: 'claude-default',
        config: { model: 'gpt-moi' },
        create: true,
      },
    })
    expect(res.status).toBe(409)

    // Đọc lại từ đĩa, không tin response: đây là bản ghi quyết định job chạy model nào.
    const onDisk = JSON.parse(fs.readFileSync(path.join(home, 'connections.json'), 'utf8'))
    const kept = onDisk.connections.find((c: any) => c.id === 'claude-api')
    expect(kept.providerId).toBe('anthropic-api')
    expect(kept.config).toEqual({ model: 'claude-cu' })
  })
})

describe('GET /api/runners — trường dẫn xuất cho UI', () => {
  test('TC-D18: default hỏng ⇒ đủ 3 trường, các trường cũ giữ nguyên hình dạng', async () => {
    await seedRunner('claude')
    // Tắt chính runner đang là default (upsert-merge, không có cờ create).
    await postJson('/api/runners', {
      runner: { id: 'claude', name: 'claude', connectionId: USABLE_CONNECTION, enabled: false },
    })

    const res = await app.request('/api/runners')
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.defaultRunnerId).toBe('claude')
    expect(body.effectiveDefaultRunnerId).toBe(null)
    expect(body.defaultRunnerIssue).toEqual({ runnerId: 'claude', reason: 'disabled' })

    // Các trường cũ không đổi hình dạng — FE cũ đọc được payload mới.
    expect(body.runners.map((r: any) => r.id)).toEqual(['claude'])
    expect(Array.isArray(body.providers)).toBe(true)
    expect(Array.isArray(body.connections)).toBe(true)
  })

  test('TC-D32: default ok ⇒ issue null và effective === defaultRunnerId', async () => {
    await seedRunner('claude')

    const body = await (await app.request('/api/runners')).json()
    expect(body.defaultRunnerIssue).toBe(null)
    expect(body.effectiveDefaultRunnerId).toBe('claude')
    expect(body.effectiveDefaultRunnerId).toBe(body.defaultRunnerId)
  })
})
