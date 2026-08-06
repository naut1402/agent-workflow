import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  submitJob,
  submitApprovalJob,
  sendTaskFeedback,
  loadJob,
  loadTaskSessionLedger,
  registerProvider,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// Task-scoped chat resume (F0011): sendTaskFeedback() is the taskId-keyed
// counterpart to sendJobFeedback() (approval flow, jobId-keyed, see
// jobApproval.test.ts). It resumes the CLI session recorded in the task's
// session ledger (sessionLedger.ts) against the task's most recent finished
// non-approval job, and tags the new job `metadata.isChatFeedback` so
// jobQueue.ts's runJob() skips advancePipelineStepChain for it.

const PROVIDER_ID = 'stub-task-feedback'

interface Captured {
  sessionId?: string
  resumeSessionId?: string
  userPrompt: string
}
const captured: Captured[] = []

let resolveGate: (() => void) | null = null
let gated = false

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    captured.push({ sessionId: req.sessionId, resumeSessionId: req.resumeSessionId, userPrompt: req.userPrompt })
    if (gated) {
      await new Promise<void>((r) => {
        resolveGate = r
      })
    }
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let home: string
let root: string
const savedEnv = { ...process.env }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function settle(id: string): Promise<ReturnType<typeof loadJob> & {}> {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

async function waitForPhase(taskId: string, predicate: (phase: string | null) => boolean, tries = 400) {
  const stateFile = path.join(root, '.dev-state', `${taskId}.json`)
  for (let i = 0; i < tries; i++) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (predicate(state.current_phase ?? null)) return state
    await sleep(5)
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  throw new Error(`current_phase never matched (last=${state.current_phase})`)
}

function seedTask(taskId: string, phase: string, requestBody = 'do the thing') {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: phase }, null, 2),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), requestBody, 'utf8')
}

function runStepLikeJob(taskId: string, stepId: string, sessionMode?: 'new' | 'resume') {
  return submitJob({
    runnerId: 'stub-runner-feedback',
    agentRef: '',
    workspace: path.join(root, 'tasks', taskId),
    userPrompt: 'do the thing',
    ...(sessionMode ? { sessionMode } : {}),
    metadata: {
      projectRoot: path.dirname(root),
      devTeamRoot: root,
      projectId: 'P1',
      taskId,
      pipelineStepId: stepId,
    },
  })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-task-feedback-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-task-feedback-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-feedback', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-feedback', connectionId: 'stub-conn-feedback', config: {} })
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    ['version: 1', 'steps:', "  - id: implementer", "    agent: ' '", "  - id: reviewer", "    agent: ' '"].join('\n'),
    'utf8',
  )
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  captured.length = 0
  gated = false
  resolveGate = null
})

describe('sendTaskFeedback — normal flow', () => {
  test('resumes the ledger session on the most recent finished job and does not re-advance current_phase', async () => {
    seedTask('T1', 'implementer')
    const first = runStepLikeJob('T1', 'implementer', 'new')
    await settle(first.id)
    // First (gate-less) step's success advances current_phase once.
    await waitForPhase('T1', (p) => p === 'reviewer')

    const ledgerBefore = loadTaskSessionLedger('P1', 'T1')
    const open = ledgerBefore.sessions.find((s) => s.status === 'open')
    expect(open).toBeTruthy()
    expect(open?.sessionId).toBeTruthy()

    const result = await sendTaskFeedback('T1', 'P1', 'follow-up question')
    expect(result.ok).toBe(true)
    if ('error' in result) throw new Error(result.error)
    if ('queued' in result) throw new Error('unexpected queued result')
    expect(result.job.parentJobId).toBe(first.id)
    expect(result.job.metadata?.isChatFeedback).toBe(true)
    expect(result.job.userPrompt).toBe('follow-up question')

    const done = await settle(result.job.id)
    expect(done.status).toBe('succeeded')

    // The feedback round resumed the same session (not a fresh one).
    const lastReq = captured[captured.length - 1]
    expect(lastReq.resumeSessionId).toBe(open!.sessionId!)
    expect(lastReq.sessionId).toBeUndefined()

    // isChatFeedback must have suppressed advancePipelineStepChain — phase
    // stays exactly where the first job's success left it.
    await sleep(30)
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'T1.json'), 'utf8'))
    expect(state.current_phase).toBe('reviewer')
  })

  test('stepId targets that step\'s job/session instead of whatever ran last', async () => {
    seedTask('T7', 'implementer')
    const implJob = runStepLikeJob('T7', 'implementer', 'new')
    await settle(implJob.id)
    await waitForPhase('T7', (p) => p === 'reviewer')
    const reviewJob = runStepLikeJob('T7', 'reviewer', 'resume')
    await settle(reviewJob.id)

    // Newest finished job is the reviewer one, but the chat was opened from the
    // implementer node — the feedback round must continue THAT job.
    const result = await sendTaskFeedback('T7', 'P1', 'về step implementer', { stepId: 'implementer' })
    expect(result.ok).toBe(true)
    if ('error' in result) throw new Error(result.error)
    if ('queued' in result) throw new Error('unexpected queued result')
    expect(result.job.parentJobId).toBe(implJob.id)
    expect(result.job.metadata?.pipelineStepId).toBe('implementer')
    await settle(result.job.id)

    // No stepId → newest finished job, as before.
    const fallback = await sendTaskFeedback('T7', 'P1', 'chung chung')
    if ('error' in fallback) throw new Error(fallback.error)
    if ('queued' in fallback) throw new Error('unexpected queued result')
    expect(fallback.job.parentJobId).not.toBe(implJob.id)
    await settle(fallback.job.id)
  })

  test('an unknown stepId falls back to the newest finished job rather than failing', async () => {
    seedTask('T8', 'implementer')
    const first = runStepLikeJob('T8', 'implementer', 'new')
    await settle(first.id)
    await waitForPhase('T8', (p) => p === 'reviewer')

    const result = await sendTaskFeedback('T8', 'P1', 'hi', { stepId: 'does-not-exist' })
    expect(result.ok).toBe(true)
    if ('error' in result) throw new Error(result.error)
    if ('queued' in result) throw new Error('unexpected queued result')
    expect(result.job.parentJobId).toBe(first.id)
    await settle(result.job.id)
  })

  test('the ledger records the pipeline step so per-step session lookup can match', async () => {
    seedTask('T9', 'implementer')
    const job = runStepLikeJob('T9', 'implementer', 'new')
    await settle(job.id)

    const ledger = loadTaskSessionLedger('P1', 'T9')
    const open = ledger.sessions.find((s) => s.status === 'open')
    expect(open?.stepIds).toContain('implementer')
  })

  test('pipeline edited to a new agent since the parent job ran: feedback resumes with the NEW agent', async () => {
    seedTask('T10', 'implementer')
    const first = runStepLikeJob('T10', 'implementer', 'new')
    await settle(first.id)
    expect(first.agentRef).toBe('')

    // Pipeline edited via chat/editor after the job ran — step now points at a
    // different agent than the one `first` was submitted with.
    fs.writeFileSync(
      path.join(root, 'tasks', 'T10', 'pipeline.yaml'),
      ['version: 1', 'steps_replace: true', 'steps:', "  - id: implementer", '    agent: agent-B'].join('\n'),
      'utf8',
    )

    const result = await sendTaskFeedback('T10', 'P1', 'hi', { stepId: 'implementer' })
    if ('error' in result) throw new Error(result.error)
    if ('queued' in result) throw new Error('unexpected queued result')
    expect(result.job.agentRef).toBe('agent-B')
    await settle(result.job.id)

    fs.rmSync(path.join(root, 'tasks', 'T10', 'pipeline.yaml'), { force: true })
  })

  test('step removed from the pipeline since the parent job ran: falls back to the old job\'s agentRef', async () => {
    seedTask('T11', 'implementer')
    const first = runStepLikeJob('T11', 'implementer', 'new')
    await settle(first.id)

    fs.writeFileSync(
      path.join(root, 'tasks', 'T11', 'pipeline.yaml'),
      ['version: 1', 'steps_replace: true', 'steps:', "  - id: reviewer", '    agent: agent-B'].join('\n'),
      'utf8',
    )

    const result = await sendTaskFeedback('T11', 'P1', 'hi', { stepId: 'implementer' })
    if ('error' in result) throw new Error(result.error)
    if ('queued' in result) throw new Error('unexpected queued result')
    expect(result.job.agentRef).toBe(first.agentRef)
    await settle(result.job.id)

    fs.rmSync(path.join(root, 'tasks', 'T11', 'pipeline.yaml'), { force: true })
  })

  test('a chat-feedback job can itself be the parent of a further feedback round', async () => {
    seedTask('T2', 'implementer')
    const first = runStepLikeJob('T2', 'implementer', 'new')
    await settle(first.id)
    await waitForPhase('T2', (p) => p === 'reviewer')

    const round1 = await sendTaskFeedback('T2', 'P1', 'round1')
    if ('error' in round1) throw new Error(round1.error)
    if ('queued' in round1) throw new Error('unexpected queued result')
    await settle(round1.job.id)

    const round2 = await sendTaskFeedback('T2', 'P1', 'round2')
    expect(round2.ok).toBe(true)
    if ('error' in round2) throw new Error(round2.error)
    if ('queued' in round2) throw new Error('unexpected queued result')
    expect(round2.job.parentJobId).toBe(round1.job.id)
    await settle(round2.job.id)
  })
})

describe('sendTaskFeedback — guards', () => {
  test('no job at all for the task → 400', async () => {
    seedTask('T3', 'implementer')
    const result = await sendTaskFeedback('T3', 'P1', 'hi')
    expect(result).toMatchObject({ ok: false, status: 400, error: 'no completed job to give feedback on' })
  })

  test('task only has an approval-flow job → 400 (approval jobs are excluded as parent)', async () => {
    seedTask('T4', 'implementer')
    const job = submitApprovalJob({
      runnerId: 'stub-runner-feedback',
      agentRef: '',
      workspace: path.join(root, 'tasks', 'T4'),
      userPrompt: 'p',
      approvalArtifact: 'design.md',
      metadata: { taskId: 'T4', projectId: 'P1' },
    })
    await settle(job.id)
    const result = await sendTaskFeedback('T4', 'P1', 'hi')
    expect(result).toMatchObject({ ok: false, status: 400, error: 'no completed job to give feedback on' })
  })

  test('ledger has no open entry → starts a new session instead of 400', async () => {
    seedTask('T5', 'implementer')
    // No sessionMode → runJob never records anything into the ledger.
    const job = runStepLikeJob('T5', 'implementer')
    await settle(job.id)
    const result = await sendTaskFeedback('T5', 'P1', 'hi')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    if ('queued' in result) throw new Error('unexpected queued result')
    expect(result.job.metadata?.inputSessionMode).toBe('new')
    expect(result.job.metadata?.isChatFeedback).toBe(true)
  })

  test('a job is already queued/running for the task, default mode → queued (not 409)', async () => {
    seedTask('T6', 'implementer')
    const first = runStepLikeJob('T6', 'implementer', 'new')
    await settle(first.id)
    await waitForPhase('T6', (p) => p === 'reviewer')

    gated = true
    const second = runStepLikeJob('T6', 'reviewer')
    for (let i = 0; i < 200 && loadJob(second.id)?.status !== 'running'; i++) await sleep(5)
    expect(loadJob(second.id)?.status).toBe('running')

    const result = await sendTaskFeedback('T6', 'P1', 'hi')
    expect(result).toMatchObject({ ok: true, queued: true })

    gated = false
    resolveGate?.()
    await settle(second.id)
  })
})
