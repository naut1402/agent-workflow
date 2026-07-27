import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { advanceStepOnJobSuccess, applyArchiveAction, applyHitlAction, writeStateAtomic } from '../../../server/tasks/state'

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
    const stateFile = await seedTask(root, 'T2', {
      current_phase: 'designer',
      hitl_pending: 'hitl-2',
    })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyHitlAction(root, 'T2', {
      action: 'reject',
      gate_id: 'hitl-2',
      feedback: 'cần bổ sung §4',
      mtime: before,
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

  test('approve accepts legacy hitl_pending boolean', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n  - id: designer\n`,
      'utf8',
    )
    const stateFile = await seedTask(root, 'T5', {
      current_phase: 'investigator',
      hitl_pending: true,
    })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyHitlAction(root, 'T5', {
      action: 'approve',
      gate_id: 'hitl-1',
      mtime: before,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.current_phase).toBe('designer')
  })

  test('gate mismatch → 400', async () => {
    const root = await tmp()
    const stateFile = await seedTask(root, 'T4', { current_phase: 'designer', hitl_pending: 'hitl-2' })
    const before = (await fs.stat(stateFile)).mtimeMs
    const result = await applyHitlAction(root, 'T4', {
      action: 'approve',
      gate_id: 'hitl-1',
      mtime: before,
    })
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(400)
  })
})

describe('advanceStepOnJobSuccess', () => {
  test('advances current_phase past a gate-less step', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: implementer\n  - id: reviewer\n    hitl: { mode: manual, gate_id: hitl-3 }\n`,
      'utf8',
    )
    await seedTask(root, 'T10', { current_phase: 'implementer' })

    const result = await advanceStepOnJobSuccess(root, 'T10', 'implementer')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('reviewer')
  })

  test('advances to completed when the gate-less step is last', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: implementer\n  - id: pr-creator\n`,
      'utf8',
    )
    await seedTask(root, 'T11', { current_phase: 'pr-creator' })

    const result = await advanceStepOnJobSuccess(root, 'T11', 'pr-creator')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('completed')
  })

  test('does not advance a step that has a HITL gate', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n  - id: designer\n`,
      'utf8',
    )
    await seedTask(root, 'T12', { current_phase: 'investigator' })

    const result = await advanceStepOnJobSuccess(root, 'T12', 'investigator')
    expect(result).toBeNull()
  })

  test('no-ops when current_phase has already moved on (race)', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: implementer\n  - id: reviewer\n`,
      'utf8',
    )
    await seedTask(root, 'T13', { current_phase: 'reviewer' })

    const result = await advanceStepOnJobSuccess(root, 'T13', 'implementer')
    expect(result).toBeNull()
  })

  test('missing state file → null', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })
    const result = await advanceStepOnJobSuccess(root, 'T14', 'implementer')
    expect(result).toBeNull()
  })
})

describe('applyArchiveAction', () => {
  test('archives a task, writing archived + archived_at', async () => {
    const root = await tmp()
    const stateFile = await seedTask(root, 'T6', { current_phase: 'completed' })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyArchiveAction(root, 'T6', { archived: true, mtime: before })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.archived).toBe(true)
    expect(typeof result.state.archived_at).toBe('string')
    expect(Number.isNaN(Date.parse(result.state.archived_at as string))).toBe(false)
  })

  test('unarchives a task, clearing archived_at', async () => {
    const root = await tmp()
    const stateFile = await seedTask(root, 'T7', {
      current_phase: 'completed',
      archived: true,
      archived_at: '2024-01-01T00:00:00.000Z',
    })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyArchiveAction(root, 'T7', { archived: false, mtime: before })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.archived).toBe(false)
    expect(result.state.archived_at).toBeNull()
  })

  test('mtime conflict → 409', async () => {
    const root = await tmp()
    const stateFile = await seedTask(root, 'T8', { current_phase: 'completed' })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyArchiveAction(root, 'T8', { archived: true, mtime: before - 1 })
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('conflict')
  })

  test('no state file → 404', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })

    const result = await applyArchiveAction(root, 'T9', { archived: true, mtime: Date.now() })
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(404)
  })
})
