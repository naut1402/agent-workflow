import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'
import { on, _resetEventBusForTest } from '../../../../src/core/events/index.js'
import type { DashboardEvent } from '../../../../src/core/events/index.js'
import {
  installEventLogSubscriber,
  uninstallEventLogSubscriberForTest,
} from '../../../../src/core/log/eventLogSubscriber.js'
import { invalidateLoggingPrefsCache } from '../../../../src/core/log/loggingPrefsIo.js'
import { readLogs } from '../../../../src/features/logs/business/store.js'

/**
 * TC-15 (nợ roadmap 1.1.0 §5): event `entity.*` của `credential` không bao giờ
 * mang secret.
 *
 * Cách assert: một chuỗi canary duy nhất đi vào request, rồi kiểm **toàn bộ
 * payload đã serialize** không chứa chuỗi đó — mạnh hơn kiểm từng field vì bắt
 * được cả secret nằm trong field lồng, mảng, hay chuỗi đã escape. Kèm một guard
 * chung ở cuối: mọi event `credential` sinh ra trong suite chỉ được có đúng 3
 * khoá `entity`/`id`/`projectId`, nên thêm field mới vào payload sau này (kể cả
 * ở hai call-site OAuth) sẽ làm case đỏ.
 */

const CANARY = 'SECRET-CANARY-20260903'
/** Khoá bị coi là mang secret — payload không được có khoá nào trong danh sách. */
const SECRET_KEYS = [
  'token',
  'apiKey',
  'api_key',
  'secret',
  'secretValue',
  'secretRef',
  'value',
  'password',
  'accessToken',
  'refreshToken',
  'credential',
  'profile',
]

let root: string
let home: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const prevKey = process.env.DASHBOARD_SECRET_KEY

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: () => root,
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

/** Mọi event `entity.*` mang `entity: 'credential'` trong cả suite. */
const allCredentialEvents: DashboardEvent[] = []
let events: DashboardEvent[] = []

function captureEntityEvents(): void {
  for (const type of ['entity.created', 'entity.updated', 'entity.deleted'] as const) {
    on(type, (e) => {
      events.push(e)
      if ((e.payload as { entity?: string }).entity === 'credential') allCredentialEvents.push(e)
    })
  }
}

function post(pathname: string, body: unknown) {
  return app.request(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Bất biến dùng lại cho mọi event credential. */
function expectNoSecret(event: DashboardEvent): void {
  const payload = event.payload as Record<string, unknown>
  expect(Object.keys(payload).sort()).toEqual(['entity', 'id', 'projectId'])
  expect(JSON.stringify(payload)).not.toContain(CANARY)
  for (const key of SECRET_KEYS) expect(payload).not.toHaveProperty(key)
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cred-event-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  // Vault key bắt buộc để `upsertCredential` mã hoá được `secretValue` — không
  // có key thì nhánh lưu secret không chạy và case mất ý nghĩa.
  process.env.DASHBOARD_SECRET_KEY = 'a'.repeat(64)
  fs.mkdirSync(home, { recursive: true })
  app = await createApp(fakeCtx())
})

afterAll(() => {
  uninstallEventLogSubscriberForTest()
  _resetEventBusForTest()
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  if (prevKey === undefined) delete process.env.DASHBOARD_SECRET_KEY
  else process.env.DASHBOARD_SECRET_KEY = prevKey
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  for (const f of ['credentials.json', 'secrets.json', 'vault.json', 'settings.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
  fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
  invalidateLoggingPrefsCache()
  _resetEventBusForTest()
  uninstallEventLogSubscriberForTest()
  events = []
  captureEntityEvents()
})

afterEach(() => {
  _resetEventBusForTest()
  uninstallEventLogSubscriberForTest()
})

describe('entity.* của credential không mang secret', () => {
  test('POST /api/credentials (secretValue) → entity.updated chỉ có entity/id/projectId', async () => {
    const res = await post('/api/credentials', {
      profile: { id: 'cred-1', provider: 'anthropic-api', label: 'Anthropic', secretValue: CANARY },
    })

    expect(res.status).toBe(200)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('entity.updated')
    expect((events[0].payload as { entity: string }).entity).toBe('credential')
    expect((events[0].payload as { id: string }).id).toBe('cred-1')
    expectNoSecret(events[0])
  })

  test('secret nằm trong field lồng nhau cũng không rò ra payload', async () => {
    const res = await post('/api/credentials', {
      profile: {
        id: 'cred-nested',
        provider: 'anthropic-api',
        secretValue: CANARY,
        // Field lạ/lồng do client gửi thêm — không được đi kèm event.
        extra: { nested: { token: CANARY, list: [CANARY] } },
      },
    })

    expect(res.status).toBe(200)
    expect(events).toHaveLength(1)
    expectNoSecret(events[0])
  })

  test('secretValue rỗng → vẫn emit, vẫn không mang secretRef', async () => {
    const res = await post('/api/credentials', {
      profile: { id: 'cred-empty', provider: 'anthropic-api', secretValue: '' },
    })

    expect(res.status).toBe(200)
    expect(events).toHaveLength(1)
    expectNoSecret(events[0])
  })

  test('DELETE /api/credentials?id= → entity.deleted không mang secret', async () => {
    await post('/api/credentials', {
      profile: { id: 'cred-del', provider: 'anthropic-api', secretValue: CANARY },
    })
    events = []

    const res = await app.request('/api/credentials?id=cred-del', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('entity.deleted')
    expectNoSecret(events[0])
  })

  test('upsert thất bại (thiếu provider) → 400, không emit', async () => {
    const res = await post('/api/credentials', { profile: { id: 'cred-bad', secretValue: CANARY } })

    expect(res.status).toBe(400)
    expect(events).toEqual([])
  })

  test('dòng events.jsonl của credential cũng không chứa canary', async () => {
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ logging: { types: { events: true } } }))
    invalidateLoggingPrefsCache()
    installEventLogSubscriber()

    await post('/api/credentials', {
      profile: { id: 'cred-log', provider: 'anthropic-api', secretValue: CANARY },
    })
    await new Promise((r) => setTimeout(r, 60))

    const entries = await readLogs({ type: 'events' })
    const credLines = entries.filter((e: any) => e.payload?.entity === 'credential')
    expect(credLines.length).toBeGreaterThan(0)
    expect(JSON.stringify(entries)).not.toContain(CANARY)
  })
})

describe('guard chung — mọi emit credential của suite', () => {
  test('không event nào có khoá ngoài entity/id/projectId', () => {
    // Chạy sau các case trên (bun test giữ thứ tự khai báo trong file).
    expect(allCredentialEvents.length).toBeGreaterThan(0)
    for (const event of allCredentialEvents) expectNoSecret(event)
  })
})
