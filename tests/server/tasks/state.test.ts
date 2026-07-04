import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applyHitlAction, writeStateAtomic } from '../../../server/tasks/state'

let dirs: string[] = []
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'task-state-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  dirs = []
})

async function seedTask(root: string, id: string, state: Record<string, unknown>) {
  await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })
  await fs.mkdir(path.join(root, 'tasks', id), { recursive: true })
  const stateFile = path.join(root, '.dev-state', `${id}.json`)
  await writeStateAtomic(stateFile, { task_id: id, ...state })
  return stateFile
}

describe('writeStateAtomic', () => {
  test('writes valid JSON and returns mtime', async () => {
    const root = await tmp()
    const fp = path.join(root, 's.json')
    const mtime = await writeStateAtomic(fp, { ok: true })
    expect(mtime).toBeGreaterThan(0)
    expect(JSON.parse(await fs.readFile(fp, 'utf8'))).toEqual({ ok: true })
  })
})

describe('applyHitlAction', () => {
  test('approve clears hitl_pending and advances phase', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n  - id: designer\n    hitl: { mode: manual, gate_id: hitl-2 }\n`,
      'utf8',
    )
    const stateFile = await seedTask(root, 'T1', {
      current_phase: 'investigator',
      hitl_pending: 'hitl-1',
    })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyHitlAction(
      root,
      'T1',
      { action: 'approve', gate_id: 'hitl-1', mtime: before },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.hitl_pending).toBeNull()
    expect(result.state.current_phase).toBe('designer')
    expect(result.state.dashboard_approved_at).toBeTruthy()
  })

  test('reject keeps phase and writes feedback', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: designer\n    hitl: { mode: manual, gate_id: hitl-2 }\n  - id: implementer\n`,
      'utf8',
    )
    await seedTask(root, 'T2', {
      current_phase: 'designer',
      hitl_pending: 'hitl-2',
    })

    const result = await applyHitlAction(root, 'T2', {
      action: 'reject',
      gate_id: 'hitl-2',
      feedback: 'cần bổ sung §4',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.current_phase).toBe('designer')
    expect(result.state.hitl_pending).toBeNull()
    expect(result.state.last_feedback).toBe('cần bổ sung §4')
    const fb = await fs.readFile(path.join(root, 'tasks', 'T2', 'hitl-feedback.md'), 'utf8')
    expect(fb).toContain('cần bổ sung §4')
  })

  test('mtime conflict → 409', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n  - id: designer\n`,
      'utf8',
    )
    const stateFile = await seedTask(root, 'T3', { current_phase: 'investigator', hitl_pending: 'hitl-1' })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyHitlAction(root, 'T3', {
      action: 'approve',
      gate_id: 'hitl-1',
      mtime: before - 1,
    })
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('conflict')
  })

  test('gate mismatch → 400', async () => {
    const root = await tmp()
    await seedTask(root, 'T4', { current_phase: 'designer', hitl_pending: 'hitl-2' })
    const result = await applyHitlAction(root, 'T4', { action: 'approve', gate_id: 'hitl-1' })
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(400)
  })
})
