import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'

// Route-level contract for DELETE /api/tasks/:id (B0009 §5) — permanently
// removes a task's files without requiring its state file to be readable
// first, so a task with broken state has a way out (unlike
// PUT /api/task-archive, see state.test.ts's applyArchiveAction 404 case).

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

function seedTask(taskId: string, state: Record<string, unknown> | null) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), 'do the thing', 'utf8')
  if (state) {
    fs.writeFileSync(
      path.join(root, '.dev-state', `${taskId}.json`),
      JSON.stringify({ task_id: taskId, ...state }, null, 2),
      'utf8',
    )
  } else {
    // Simulate a broken state file — the exact scenario this route exists for.
    fs.writeFileSync(path.join(root, '.dev-state', `${taskId}.json`), 'not json', 'utf8')
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-task-delete-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  app = await createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})

describe('DELETE /api/tasks/:id', () => {
  test('200: deletes a task with a valid state file', async () => {
    seedTask('D1', { current_phase: 'completed' })
    const res = await app.request('/api/tasks/D1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'D1', deleted: true })
    expect(fs.existsSync(path.join(root, 'tasks', 'D1'))).toBe(false)
    expect(fs.existsSync(path.join(root, '.dev-state', 'D1.json'))).toBe(false)
  })

  test('200: deletes a task with a corrupt/unreadable state file (the case applyArchiveAction cannot handle)', async () => {
    seedTask('D2', null)
    const res = await app.request('/api/tasks/D2', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(root, 'tasks', 'D2'))).toBe(false)
  })

  test('200: idempotent for a task id that does not exist', async () => {
    const res = await app.request('/api/tasks/does-not-exist', { method: 'DELETE' })
    expect(res.status).toBe(200)
  })

  test('400: rejects a path-traversal task id', async () => {
    const res = await app.request(`/api/tasks/${encodeURIComponent('../../etc')}`, { method: 'DELETE' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid task id')
  })
})
