import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { advanceStepOnJobSuccess, applyArchiveAction, applyHitlAction, applyRenameAction, deleteTask, repairTaskState, resetPipelineStepAssumingLock, writeStateAtomic } from '../../../../src/features/monitor/business/tasks/state'
import { on, _resetEventBusForTest } from '../../../../src/core/events/index.js'
import { listJobs, loadJob, registerProvider, submitJob, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// applyHitlAction's reject branch dispatches feedback through the REAL
// sendTaskFeedback (fire-and-forget), not a mock: `business/index.js` is a
// shared barrel imported by many other test suites (chat/, runner/...), and
// bun's test runner loads every test file's top-level code before running any
// test body — a `mock.module` swap here would leak the stub into those other
// suites regardless of when it's undone. A stub runner provider + a real
// finished job gives sendTaskFeedback something to resume, so its dispatch
// (or lack thereof) can be observed as a real follow-up job.
const FEEDBACK_PROVIDER_ID = 'stub-applyhitl-feedback'
const stubFeedbackProvider: RunnerProvider = {
  providerId: FEEDBACK_PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(): Promise<ExecuteResult> {
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}
const savedEnv = { ...process.env }
let jobsHome: string

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
async function settleJob(id: string) {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled`)
}
/** Poll for a follow-up job `sendTaskFeedback` would submit off of `parentId`. */
async function findFollowUpJob(parentId: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const found = listJobs(200).find((j) => j.metadata?.parentJobId === parentId)
    if (found) return found
    await sleep(5)
  }
  return null
}

beforeAll(async () => {
  jobsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'task-state-jobs-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = jobsHome
  registerProvider(stubFeedbackProvider)
  upsertConnection({ id: 'stub-conn-applyhitl', kind: 'local-console', providerId: FEEDBACK_PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-applyhitl', connectionId: 'stub-conn-applyhitl', config: {} })
})
afterAll(async () => {
  process.env = savedEnv
  await fs.rm(jobsHome, { recursive: true, force: true })
})

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

    // A finished job for the gated step, so sendTaskFeedback (called by the
    // reject branch) has a parent job to resume.
    const parent = submitJob({
      runnerId: 'stub-runner-applyhitl',
      agentRef: '',
      workspace: path.join(root, 'tasks', 'T2'),
      userPrompt: 'do designer work',
      metadata: { devTeamRoot: root, projectId: 'proj-1', taskId: 'T2', pipelineStepId: 'designer' },
    })
    await settleJob(parent.id)

    const result = await applyHitlAction(
      root,
      'T2',
      {
        action: 'reject',
        gate_id: 'hitl-2',
        feedback: 'cần bổ sung §4',
        mtime: before,
      },
      'proj-1',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.current_phase).toBe('designer')
    expect(result.state.hitl_pending).toBeNull()
    expect(result.state.last_feedback).toBe('cần bổ sung §4')
    const fb = await fs.readFile(path.join(root, 'tasks', 'T2', 'hitl-feedback.md'), 'utf8')
    expect(fb).toContain('cần bổ sung §4')

    const followUp = await findFollowUpJob(parent.id)
    expect(followUp).not.toBeNull()
    expect(followUp?.userPrompt).toBe('cần bổ sung §4')
    expect(followUp?.metadata?.isChatFeedback).toBe(true)
  })

  test('reject without feedback does not dispatch sendTaskFeedback', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: designer\n    hitl: { mode: manual, gate_id: hitl-2 }\n  - id: implementer\n`,
      'utf8',
    )
    const stateFile = await seedTask(root, 'T2b', {
      current_phase: 'designer',
      hitl_pending: 'hitl-2',
    })
    const before = (await fs.stat(stateFile)).mtimeMs

    const parent = submitJob({
      runnerId: 'stub-runner-applyhitl',
      agentRef: '',
      workspace: path.join(root, 'tasks', 'T2b'),
      userPrompt: 'do designer work',
      metadata: { devTeamRoot: root, projectId: 'proj-1', taskId: 'T2b', pipelineStepId: 'designer' },
    })
    await settleJob(parent.id)

    const result = await applyHitlAction(root, 'T2b', {
      action: 'reject',
      gate_id: 'hitl-2',
      mtime: before,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.hitl_pending).toBeNull()

    const followUp = await findFollowUpJob(parent.id, 10)
    expect(followUp).toBeNull()
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

  test('auto_review: true skips the gate and advances past it', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      `version: 1\nsteps:\n  - id: investigator\n    hitl: { mode: manual, gate_id: hitl-1 }\n  - id: designer\n`,
      'utf8',
    )
    await seedTask(root, 'T12c', { current_phase: 'investigator', auto_review: true })

    const result = await advanceStepOnJobSuccess(root, 'T12c', 'investigator')
    expect(result).not.toBeNull()
    expect(result?.state.hitl_pending).toBeFalsy()
    expect(result?.state.current_phase).toBe('designer')
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

describe('applyRenameAction', () => {
  test('writes state.name', async () => {
    const root = await tmp()
    const stateFile = await seedTask(root, 'RN1', { current_phase: 'completed' })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyRenameAction(root, 'RN1', { name: 'New name', mtime: before })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.name).toBe('New name')
  })

  test('mtime conflict → 409, state left untouched', async () => {
    const root = await tmp()
    const stateFile = await seedTask(root, 'RN2', { current_phase: 'completed' })
    const before = (await fs.stat(stateFile)).mtimeMs

    const result = await applyRenameAction(root, 'RN2', { name: 'New name', mtime: before - 1 })
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('conflict')

    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    expect(state.name).toBeUndefined()
  })

  test('no state file → 404', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })

    const result = await applyRenameAction(root, 'RN3', { name: 'x', mtime: Date.now() })
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

describe('resetPipelineStepAssumingLock', () => {
  const pipelineWithRetry = [
    'version: 1',
    'steps:',
    '  - id: investigator',
    '    produces: [investigate.md]',
    '  - id: designer',
    '    produces: [design.md]',
    '  - id: implementer',
    '    produces: [phpstan.md]',
    '  - id: reviewer',
    '    produces: [review.md, test-spec.md]',
    '    hitl: { mode: manual, gate_id: hitl-3, retry: { on: must_fix, restart_from: implementer, max: 2 } }',
    '  - id: pr-creator',
    '    produces: [pr-desc.md]',
  ].join('\n')

  async function seedFiles(root: string, taskId: string, files: Record<string, string>) {
    await fs.mkdir(path.join(root, 'tasks', taskId), { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(root, 'tasks', taskId, name), content, 'utf8')
    }
  }

  async function exists(root: string, taskId: string, name: string): Promise<boolean> {
    try {
      await fs.stat(path.join(root, 'tasks', taskId, name))
      return true
    } catch {
      return false
    }
  }

  test('non-cascade removes only the target step\'s own produces', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS1', { current_phase: 'completed' })
    await seedFiles(root, 'RS1', { 'phpstan.md': 'impl', 'review.md': 'r' })

    const result = await resetPipelineStepAssumingLock(root, 'RS1', stateFile, 'implementer', false)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.removedSteps).toEqual(['implementer'])
    expect(await exists(root, 'RS1', 'phpstan.md')).toBe(false)
    expect(await exists(root, 'RS1', 'review.md')).toBe(true)
  })

  test('cascade removes the target and every step after it', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS2', { current_phase: 'completed' })
    await seedFiles(root, 'RS2', {
      'phpstan.md': 'impl',
      'review.md': 'r',
      'test-spec.md': 't',
      'pr-desc.md': 'p',
    })

    const result = await resetPipelineStepAssumingLock(root, 'RS2', stateFile, 'implementer', true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.removedSteps).toEqual(['implementer', 'reviewer', 'pr-creator'])
    for (const f of ['phpstan.md', 'review.md', 'test-spec.md', 'pr-desc.md']) {
      expect(await exists(root, 'RS2', f)).toBe(false)
    }
  })

  test('deletes the -po.md sidecar alongside its main produces file', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS3', { current_phase: 'completed' })
    await seedFiles(root, 'RS3', { 'review.md': 'r', 'review-po.md': 'po', 'test-spec.md': 't' })

    const result = await resetPipelineStepAssumingLock(root, 'RS3', stateFile, 'reviewer', false)
    expect(result.ok).toBe(true)
    expect(await exists(root, 'RS3', 'review.md')).toBe(false)
    expect(await exists(root, 'RS3', 'review-po.md')).toBe(false)
  })

  test('leaves qa.md and hitl-feedback.md untouched even on a full cascade', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS4', { current_phase: 'completed' })
    await seedFiles(root, 'RS4', {
      'investigate.md': 'i',
      'qa.md': 'qa history',
      'hitl-feedback.md': 'feedback history',
    })

    const result = await resetPipelineStepAssumingLock(root, 'RS4', stateFile, 'investigator', true)
    expect(result.ok).toBe(true)
    expect(await exists(root, 'RS4', 'qa.md')).toBe(true)
    expect(await exists(root, 'RS4', 'hitl-feedback.md')).toBe(true)
  })

  test('sets current_phase to stepId and clears hitl_pending', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS5', { current_phase: 'reviewer', hitl_pending: 'hitl-3' })

    const result = await resetPipelineStepAssumingLock(root, 'RS5', stateFile, 'designer', false)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.current_phase).toBe('designer')
    expect(result.state.hitl_pending).toBeNull()
  })

  // #225 vấn đề 4: runTaskStep (controller.ts) uses `last_reset_at` to tell a fresh
  // reset apart from the "heal stuck phase" fallback — a `succeeded` job for this step
  // that finished before this timestamp must not be mistaken for "already done".
  test('sets last_reset_at to an ISO-8601 timestamp on every reset', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS14', { current_phase: 'reviewer' })

    const before = new Date().toISOString()
    const result = await resetPipelineStepAssumingLock(root, 'RS14', stateFile, 'designer', false)
    const after = new Date().toISOString()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const resetAt = result.state.last_reset_at as string
    expect(typeof resetAt).toBe('string')
    expect(resetAt >= before && resetAt <= after).toBe(true)
  })

  test('review_round resets to 0 when the target is at or before the retry step', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS6', { current_phase: 'completed', review_round: 2 })

    const result = await resetPipelineStepAssumingLock(root, 'RS6', stateFile, 'implementer', false)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.review_round).toBe(0)
  })

  test('review_round is left untouched when the target is after the retry step', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS7', { current_phase: 'completed', review_round: 2 })

    const result = await resetPipelineStepAssumingLock(root, 'RS7', stateFile, 'pr-creator', false)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.review_round).toBe(2)
  })

  test('doc_review_round.investigate/design reset to 0 only for removed steps', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS8', {
      current_phase: 'completed',
      doc_review_round: { investigate: 2, design: 1 },
    })

    const result = await resetPipelineStepAssumingLock(root, 'RS8', stateFile, 'designer', true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Cascade from designer removes designer/implementer/reviewer/pr-creator —
    // investigator is untouched, so its doc_review_round entry must not reset.
    expect(result.state.doc_review_round).toEqual({ investigate: 2, design: 0 })
  })

  test('defaults doc_review_round to {investigate:0, design:0} when missing on old state', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS9', { current_phase: 'completed' })

    const result = await resetPipelineStepAssumingLock(root, 'RS9', stateFile, 'investigator', false)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.doc_review_round).toEqual({ investigate: 0, design: 0 })
  })

  test('invalid stepId → 400, no file touched', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS10', { current_phase: 'completed' })

    const result = await resetPipelineStepAssumingLock(root, 'RS10', stateFile, 'nope', false)
    expect(result.ok).toBe(false)
    if ('error' in result) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('invalid stepId')
    }
  })

  test('missing state file → 404', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })

    const result = await resetPipelineStepAssumingLock(
      root,
      'RS11',
      path.join(root, '.dev-state', 'RS11.json'),
      'investigator',
      false,
    )
    expect(result.ok).toBe(false)
    if ('error' in result) expect(result.status).toBe(404)
  })

  test('cascade over steps that never produced anything is a no-op delete, still listed in removedSteps', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS12', { current_phase: 'implementer' })
    await seedFiles(root, 'RS12', { 'phpstan.md': 'impl' })
    // reviewer/pr-creator never ran — no files for them on disk.

    const result = await resetPipelineStepAssumingLock(root, 'RS12', stateFile, 'implementer', true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.removedSteps).toEqual(['implementer', 'reviewer', 'pr-creator'])
  })

  test('emits task.advanced with reason "reset" after persist (no dedicated task.reset type)', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), pipelineWithRetry, 'utf8')
    const stateFile = await seedTask(root, 'RS13', { current_phase: 'completed' })

    const events: Array<Record<string, unknown>> = []
    on('task.advanced', (e) => {
      events.push(e.payload)
    })
    const result = await resetPipelineStepAssumingLock(root, 'RS13', stateFile, 'designer', true)
    expect(result.ok).toBe(true)
    expect(events).toEqual([
      {
        taskId: 'RS13',
        stepId: 'designer',
        currentPhase: 'designer',
        reason: 'reset',
        cascade: true,
        removedSteps: ['designer', 'implementer', 'reviewer', 'pr-creator'],
      },
    ])
  })
})
