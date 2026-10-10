import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import { on } from '../../../../src/backend/events/index.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { handleEvent, recentOf } from '../../../../src/features/orchestrator/business/decisionLoop.js'
import {
  mintOrchestratorToken,
  resolveOrchestratorToken,
} from '../../../../src/features/orchestrator/business/orchestratorTokens.js'

/**
 * Tfb77cf90-P10 (#449) — characterization nút Stop trên node điều phối
 * (`PUT /api/task-orchestrator {halted: true}`), chốt TRƯỚC khi đường này đổi
 * sang gọi `announceHalt()` của orchestrator.
 *
 * Bề mặt chấm: event `orchestrator.halted` phát ra (đúng tập field, đúng một
 * lần) và token điều phối của task bị thu hồi — đúng task, không đụng task khác.
 */

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

interface Seen {
  type: string
  payload: Record<string, unknown>
}
let seen: Seen[] = []
let off: (() => void) | null = null

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

function stateFileOf(taskId: string) {
  return path.join(root, '.dev-state', `${taskId}.json`)
}

function seedTask(taskId: string, state: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    stateFileOf(taskId),
    JSON.stringify({ task_id: taskId, current_phase: 'investigator', orchestrator_enabled: true, ...state }, null, 2),
    'utf8',
  )
}

async function orchestratorButton(taskId: string, halted: boolean) {
  const mtime = fs.statSync(stateFileOf(taskId)).mtimeMs
  return app.request(`/api/task-orchestrator?id=${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ halted, mtime }),
  })
}

function halts(taskId: string): Seen[] {
  return seen.filter((e) => e.type === 'orchestrator.halted' && e.payload.taskId === taskId)
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-stop-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    JSON.stringify({ version: 1, steps: [{ id: 'investigator', agent: ' ' }] }),
    'utf8',
  )
  app = await createApp(fakeCtx())
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  seen = []
  off = on('*', (e) => {
    seen.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> })
  })
})

afterEach(() => {
  off?.()
  off = null
})

describe('Stop trên node điều phối — event orchestrator.halted', () => {
  test('phát ĐÚNG MỘT orchestrator.halted, đúng tập field, reason user_stop', async () => {
    seedTask('H1')
    const res = await orchestratorButton('H1', true)
    expect(res.status).toBe(200)

    const list = halts('H1')
    expect(list).toHaveLength(1)
    expect(list[0].payload).toEqual({
      taskId: 'H1',
      projectId: undefined,
      devTeamRoot: root,
      reason: 'user_stop',
    })
  })

  test('Run (halted: false) ⇒ không phát orchestrator.halted', async () => {
    seedTask('H2', { orchestrator_halted: true })
    expect((await orchestratorButton('H2', false)).status).toBe(200)
    expect(halts('H2')).toHaveLength(0)
  })

  test('Stop bị từ chối (mtime cũ, 409) ⇒ không phát orchestrator.halted', async () => {
    seedTask('H3')
    const res = await app.request('/api/task-orchestrator?id=H3', {
      method: 'PUT',
      body: JSON.stringify({ halted: true, mtime: 1 }),
    })
    expect(res.status).toBe(409)
    expect(halts('H3')).toHaveLength(0)
  })
})

describe('Stop trên node điều phối — thu hồi token điều phối', () => {
  test('token của task bị Stop hết hiệu lực ngay, token task khác còn nguyên', async () => {
    seedTask('K1')
    seedTask('K2')
    const mine = mintOrchestratorToken({ root, taskId: 'K1', projectId: '' })
    const other = mintOrchestratorToken({ root, taskId: 'K2', projectId: '' })
    const otherRoot = mintOrchestratorToken({ root: `${root}-other`, taskId: 'K1', projectId: '' })

    expect((await orchestratorButton('K1', true)).status).toBe(200)

    expect(resolveOrchestratorToken(mine)).toBeNull()
    expect(resolveOrchestratorToken(other)).toEqual({ root, taskId: 'K2', projectId: '' })
    // Cùng taskId nhưng root khác ⇒ không phải task này.
    expect(resolveOrchestratorToken(otherRoot)).toEqual({ root: `${root}-other`, taskId: 'K1', projectId: '' })
  })

  test('Run (halted: false) ⇒ không thu hồi token nào', async () => {
    seedTask('K3', { orchestrator_halted: true })
    const token = mintOrchestratorToken({ root, taskId: 'K3', projectId: '' })
    expect((await orchestratorButton('K3', false)).status).toBe(200)
    expect(resolveOrchestratorToken(token)).toEqual({ root, taskId: 'K3', projectId: '' })
  })
})

describe('Stop trên node điều phối — KHÔNG quên bộ nhớ của task (giữ hành vi)', () => {
  // Khác `haltTask` (agent tự halt): đường Stop không gọi `forgetTask`, nên
  // ring buffer quan sát (và bộ đếm lượt) của task còn nguyên sau Stop.
  test('quan sát đã ghi trước Stop vẫn còn sau Stop', async () => {
    seedTask('M1')
    await handleEvent({
      type: 'hitl.pending',
      at: new Date().toISOString(),
      payload: { taskId: 'M1', devTeamRoot: root },
    } as any)
    expect(recentOf(root, 'M1')).toHaveLength(1)

    expect((await orchestratorButton('M1', true)).status).toBe(200)
    expect(recentOf(root, 'M1')).toHaveLength(1)
  })
})
