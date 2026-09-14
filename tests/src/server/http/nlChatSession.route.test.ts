import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { loadJob, registerProvider, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types'

// Hồi quy trực tiếp của T536c80fd: catalog trước đây chỉ được bơm ở lượt 1, nên
// pipeline profile tạo ra SAU khi mở phiên không bao giờ tới được agent và
// người dùng buộc phải mở phiên chat mới. Ca dưới đi qua đúng đường HTTP thật
// (`POST /api/nl-chat/sessions` → ghi profile lên đĩa → `POST …/messages`) và
// đọc prompt mà controller gửi xuống runner.

const PROVIDER_ID = 'stub-nl-chat-route'

const captured: string[] = []

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    captured.push(req.userPrompt)
    return { ok: true, exitCode: 0, durationMs: 1, stdout: 'Bạn muốn dùng pipeline nào?' }
  },
}

let home: string
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function settle(id: string) {
  for (let i = 0; i < 400; i += 1) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled`)
}

function writeProfile(name: string): void {
  fs.mkdirSync(path.join(root, 'pipeline-profiles'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'pipeline-profiles', `${name}.yaml`),
    'version: 1\nsteps: []\n',
    'utf8',
  )
}

async function postJson(url: string, body: unknown) {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Mở phiên và đợi lượt 1 chạy xong; trả về chatSessionId. */
async function openSession(message: string): Promise<string> {
  const res = await postJson('/api/nl-chat/sessions', {
    entityType: 'task',
    message,
    runnerId: 'stub-runner-nlchat-route',
  })
  expect(res.status).toBe(201)
  const body: any = await res.json()
  await settle(body.job.id)
  return body.chatSessionId
}

async function sendMessage(id: string, message: string): Promise<void> {
  const res = await postJson(`/api/nl-chat/sessions/${id}/messages`, { message })
  expect(res.status).toBe(201)
  const body: any = await res.json()
  await settle(body.job.id)
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-nlchat-route-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-nlchat-route-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-nlchat-route', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-nlchat-route', connectionId: 'stub-conn-nlchat-route', config: {} })
  app = await createApp(fakeCtx())
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  captured.length = 0
  fs.rmSync(path.join(root, 'pipeline-profiles'), { recursive: true, force: true })
})

describe('POST /api/nl-chat/sessions/:id/messages', () => {
  test('profile tạo SAU khi mở phiên vào được prompt của lượt kế tiếp', async () => {
    writeProfile('pipeline-cu')
    const id = await openSession('tạo task dùng pipeline nào đó')

    expect(captured).toHaveLength(1)
    expect(captured[0]).toContain('pipeline-cu')
    expect(captured[0]).not.toContain('pipeline-vua-tao')

    // Người dùng sang tab Pipeline Editor tạo profile mới giữa phiên.
    writeProfile('pipeline-vua-tao')
    await sendMessage(id, 'đổi sang pipeline vừa tạo')

    expect(captured).toHaveLength(2)
    expect(captured[1]).toContain('[PIPELINE PROFILE]')
    expect(captured[1]).toContain('pipeline-vua-tao')
    expect(captured[1]).toContain('pipeline-cu')
  })

  test('profile bị xoá giữa phiên biến mất khỏi prompt của lượt kế tiếp', async () => {
    writeProfile('pipeline-se-bi-xoa')
    const id = await openSession('tạo task')
    expect(captured[0]).toContain('pipeline-se-bi-xoa')

    fs.rmSync(path.join(root, 'pipeline-profiles', 'pipeline-se-bi-xoa.yaml'))
    await sendMessage(id, 'tiếp')

    expect(captured[1]).not.toContain('pipeline-se-bi-xoa')
  })

  test('mọi lượt sau đều tươi, không riêng lượt 2', async () => {
    const id = await openSession('tạo task')
    await sendMessage(id, 'lượt 2')

    writeProfile('pipeline-luot-3')
    await sendMessage(id, 'lượt 3')

    expect(captured).toHaveLength(3)
    expect(captured[1]).not.toContain('pipeline-luot-3')
    expect(captured[2]).toContain('pipeline-luot-3')
  })

  test('đúng MỘT khối catalog trong prompt của mỗi lượt', async () => {
    writeProfile('pipeline-cu')
    const id = await openSession('tạo task')
    await sendMessage(id, 'tiếp')

    for (const prompt of captured) {
      expect(prompt.split('=== CATALOG HIỆN CÓ TRONG HỆ THỐNG')).toHaveLength(2)
    }
  })

  test('section vẫn lọc theo entityType ở lượt > 1 — draft agent không gánh danh sách pipeline', async () => {
    writeProfile('pipeline-cu')
    const res = await postJson('/api/nl-chat/sessions', {
      entityType: 'agent',
      message: 'tạo agent review',
      runnerId: 'stub-runner-nlchat-route',
    })
    const body: any = await res.json()
    await settle(body.job.id)

    await sendMessage(body.chatSessionId, 'thêm skill run-lint')

    expect(captured[1]).toContain('[SKILL]')
    expect(captured[1]).not.toContain('[PIPELINE PROFILE]')
  })
})
