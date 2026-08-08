import { afterEach, describe, expect, test, beforeEach } from 'bun:test'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { advanceStepOnJobSuccess, applyArchiveAction, applyHitlAction, deleteTask, repairTaskState, writeStateAtomic } from '../../../../src/features/monitor/business/tasks/state'
import { on, _resetEventBusForTest } from '../../../../src/core/events/index.js'

let dirs: string[] = []
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'task-state-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  dirs = []
  _resetEventBusForTest()
})

beforeEach(() => {
  _resetEventBusForTest()
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

  test('opens the HITL gate instead of advancing when the step has one', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n  - id: designer\n`,
      'utf8',
    )
    await seedTask(root, 'T12', { current_phase: 'investigator' })

    const result = await advanceStepOnJobSuccess(root, 'T12', 'investigator')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('investigator')
    expect(result?.state.hitl_pending).toBe('hitl-1')
  })

  test('no-ops when a gate is already pending', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n  - id: designer\n`,
      'utf8',
    )
    await seedTask(root, 'T12b', { current_phase: 'investigator', hitl_pending: 'hitl-1' })

    const result = await advanceStepOnJobSuccess(root, 'T12b', 'investigator')
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

  test('hitl.pending emits after state file has hitl_pending', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n  - id: designer\n`,
      'utf8',
    )
    const stateFile = await seedTask(root, 'T12e', { current_phase: 'investigator' })
    let pendingAtEmit: unknown
    on('hitl.pending', () => {
      // Sync read — emit does not await async handlers.
      pendingAtEmit = JSON.parse(readFileSync(stateFile, 'utf8')).hitl_pending
    })
    await advanceStepOnJobSuccess(root, 'T12e', 'investigator')
    expect(pendingAtEmit).toBe('hitl-1')
  })

  test('task.advanced emits with new currentPhase after persist', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: implementer\n  - id: reviewer\n`,
      'utf8',
    )
    await seedTask(root, 'T10e', { current_phase: 'implementer' })
    const events: Array<Record<string, unknown>> = []
    on('task.advanced', (e) => {
      events.push(e.payload)
    })
    await advanceStepOnJobSuccess(root, 'T10e', 'implementer')
    expect(events).toEqual([{ taskId: 'T10e', stepId: 'implementer', currentPhase: 'reviewer' }])
  })
})

describe('advanceStepOnJobSuccess — review retry', () => {
  const retryPipeline = `version: 1\nsteps:\n  - id: implementer\n  - id: reviewer\n    produces: [review.md]\n    hitl: { mode: manual, gate_id: hitl-3, retry: { on: must_fix, restart_from: implementer, max: 2 } }\n  - id: pr-creator\n`

  async function seedReview(root: string, taskId: string, recommendation: string) {
    await fs.mkdir(path.join(root, 'tasks', taskId), { recursive: true })
    await fs.writeFile(path.join(root, 'tasks', taskId, 'review.md'), `## Summary\nRecommendation: ${recommendation}\n`, 'utf8')
  }

  test('NEEDS_CHANGES, review_round < max → loops back to restart_from', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), retryPipeline, 'utf8')
    await seedTask(root, 'T20', { current_phase: 'reviewer', review_round: 0 })
    await seedReview(root, 'T20', 'NEEDS_CHANGES')

    const events: Array<Record<string, unknown>> = []
    on('task.advanced', (e) => {
      events.push(e.payload)
    })
    const result = await advanceStepOnJobSuccess(root, 'T20', 'reviewer')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('implementer')
    expect(result?.state.review_round).toBe(1)
    expect(result?.state.hitl_pending).toBeNull()
    expect(events).toEqual([
      {
        taskId: 'T20',
        stepId: 'reviewer',
        currentPhase: 'implementer',
        reason: 'review_retry',
      },
    ])
  })

  test('NEEDS_CHANGES past retry.max → falls through to the gate instead of standing silently re-runnable', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), retryPipeline, 'utf8')
    await seedTask(root, 'T21', { current_phase: 'reviewer', review_round: 2 })
    await seedReview(root, 'T21', 'NEEDS_CHANGES')

    const result = await advanceStepOnJobSuccess(root, 'T21', 'reviewer')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('reviewer')
    expect(result?.state.review_round).toBe(3)
    expect(result?.state.hitl_pending).toBe('hitl-3')
  })

  test('APPROVE verdict falls through to the existing gate behavior', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), retryPipeline, 'utf8')
    await seedTask(root, 'T22', { current_phase: 'reviewer', review_round: 0 })
    await seedReview(root, 'T22', 'APPROVE')

    const result = await advanceStepOnJobSuccess(root, 'T22', 'reviewer')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('reviewer')
    expect(result?.state.hitl_pending).toBe('hitl-3')
  })

  test('artifact missing a Recommendation line → fail-safe, falls through to gate', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), retryPipeline, 'utf8')
    await seedTask(root, 'T23', { current_phase: 'reviewer', review_round: 0 })
    await fs.mkdir(path.join(root, 'tasks', 'T23'), { recursive: true })
    await fs.writeFile(path.join(root, 'tasks', 'T23', 'review.md'), 'no verdict line here\n', 'utf8')

    const result = await advanceStepOnJobSuccess(root, 'T23', 'reviewer')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('reviewer')
    expect(result?.state.hitl_pending).toBe('hitl-3')
  })

  test('restart_from points to a step no longer in the pipeline → no throw, falls through to gate', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: reviewer\n    produces: [review.md]\n    hitl: { mode: manual, gate_id: hitl-3, retry: { on: must_fix, restart_from: implementer, max: 2 } }\n`,
      'utf8',
    )
    await seedTask(root, 'T24', { current_phase: 'reviewer', review_round: 0 })
    await seedReview(root, 'T24', 'NEEDS_CHANGES')

    const result = await advanceStepOnJobSuccess(root, 'T24', 'reviewer')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('reviewer')
    expect(result?.state.hitl_pending).toBe('hitl-3')
  })

  test('step without hitl.retry declared → unaffected, advances/gates as before', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: implementer\n  - id: reviewer\n    produces: [review.md]\n  - id: pr-creator\n`,
      'utf8',
    )
    await seedTask(root, 'T25', { current_phase: 'reviewer' })
    await seedReview(root, 'T25', 'NEEDS_CHANGES')

    const result = await advanceStepOnJobSuccess(root, 'T25', 'reviewer')
    expect(result).not.toBeNull()
    expect(result?.state.current_phase).toBe('pr-creator')
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

describe('deleteTask', () => {
  test('removes tasks/<id>, .dev-state/<id>.json and the flow profile', async () => {
    const root = await tmp()
    await seedTask(root, 'T10', { current_phase: 'completed' })
    await fs.mkdir(path.join(root, 'flow-profiles'), { recursive: true })
    await fs.writeFile(path.join(root, 'flow-profiles', 'T10.json'), '{}', 'utf8')

    const result = await deleteTask(root, 'T10')
    expect(result.ok).toBe(true)

    await expect(fs.stat(path.join(root, 'tasks', 'T10'))).rejects.toThrow()
    await expect(fs.stat(path.join(root, '.dev-state', 'T10.json'))).rejects.toThrow()
    await expect(fs.stat(path.join(root, 'flow-profiles', 'T10.json'))).rejects.toThrow()
  })

  test('succeeds even when the state file is missing/corrupt (unlike applyArchiveAction)', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })
    await fs.mkdir(path.join(root, 'tasks', 'T11'), { recursive: true })
    await fs.writeFile(path.join(root, '.dev-state', 'T11.json'), 'not json', 'utf8')

    const result = await deleteTask(root, 'T11')
    expect(result.ok).toBe(true)
    await expect(fs.stat(path.join(root, 'tasks', 'T11'))).rejects.toThrow()
  })

  test('is idempotent for a task that does not exist at all', async () => {
    const root = await tmp()
    const result = await deleteTask(root, 'T12')
    expect(result.ok).toBe(true)
  })
})

describe('repairTaskState', () => {
  test('normalizes non-string current_phase to completed', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n  - id: designer\n`,
      'utf8',
    )
    await seedTask(root, 'R1', { current_phase: 42, hitl_pending: null })

    const result = await repairTaskState(root, 'R1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.current_phase).toBe('completed')
    expect(result.state.hitl_pending).toBeNull()
  })

  test('clears non-string hitl_pending', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n`,
      'utf8',
    )
    await seedTask(root, 'R2', { current_phase: 'investigator', hitl_pending: { gate: 'x' } })

    const result = await repairTaskState(root, 'R2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.current_phase).toBe('investigator')
    expect(result.state.hitl_pending).toBeNull()
  })

  test('clears empty-string current_phase', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n`,
      'utf8',
    )
    await seedTask(root, 'R3', { current_phase: '', hitl_pending: 'stale-gate' })

    const result = await repairTaskState(root, 'R3')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.current_phase).toBe('completed')
    expect(result.state.hitl_pending).toBeNull()
  })
})
