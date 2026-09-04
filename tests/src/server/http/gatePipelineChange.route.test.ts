import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'
import {
  loadJob,
  listJobs,
  registerProvider,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type {
  ExecuteRequest,
  ExecuteResult,
  RunnerProvider,
} from '../../../../src/features/runner/business/types.js'
import { on } from '../../../../src/core/events/index.js'

/**
 * T8e63498c — HITL gate state vs. a pipeline that changed underneath it.
 *
 * The reported bug: run a gated step, then edit the pipeline so no gate is left.
 * The server kept blocking on the now-deleted gate while the UI drew no node to
 * approve, so the task was stuck with no way forward. Everything here is driven
 * from the outside (write the pipeline through the real editor endpoint, poll
 * `GET /api/tasks`, POST run-step, PUT the approve action) — `GET /api/tasks` is
 * the contract PipelineView/badge/notifications render from, so asserting on it
 * is the proxy for "what the UI shows" (no Playwright in this scope).
 *
 * Two invariants drive the cases below:
 *   INV-1 never walk past a gate the pipeline still declares at the cursor.
 *   INV-2 blocked ⇔ approvable: never block without exactly one node to approve.
 *
 * Harness mirrors runStep.route.test.ts: a stub provider succeeds instantly so
 * the job queue's chain-on-success hook runs within `settle()` polling.
 */

const PROVIDER_ID = 'stub-gate-pipeline-change'
const RUNNER_ID = 'stub-runner-gate-change'

let resolveGate: (() => void) | null = null
let gated = false

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(_req: ExecuteRequest): Promise<ExecuteResult> {
    if (gated) {
      await new Promise<void>((r) => {
        resolveGate = r
      })
    }
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

// `P_gate` / `P_nogate` from the test spec: only `designer` carries the gate, so
// finishing `designer` is what blocks `implementer`.
type StepSpec = { id: string; gate?: string }
const P_GATE: StepSpec[] = [
  { id: 'fetch' },
  { id: 'designer', gate: 'g1' },
  { id: 'implementer' },
  { id: 'reviewer' },
]
const P_NOGATE: StepSpec[] = [
  { id: 'fetch' },
  { id: 'designer' },
  { id: 'implementer' },
  { id: 'reviewer' },
]

function pipelineBody(steps: StepSpec[]) {
  return {
    version: 1,
    steps: steps.map((s) => ({
      id: s.id,
      agent: ' ',
      ...(s.gate ? { hitl: { mode: 'manual', gate_id: s.gate } } : {}),
    })),
  }
}

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
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

function stateFileOf(taskId: string) {
  return path.join(root, '.dev-state', `${taskId}.json`)
}

function readStateFile(taskId: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(stateFileOf(taskId), 'utf8'))
}

async function waitForState(
  taskId: string,
  predicate: (state: Record<string, any>) => boolean,
  tries = 400,
) {
  for (let i = 0; i < tries; i++) {
    const state = readStateFile(taskId)
    if (predicate(state)) return state
    await sleep(5)
  }
  throw new Error(`state never matched (last=${JSON.stringify(readStateFile(taskId))})`)
}

function seedTask(taskId: string, state: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    stateFileOf(taskId),
    JSON.stringify({ task_id: taskId, ...state }, null, 2),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), 'do the thing', 'utf8')
}

/**
 * A task sitting at an open gate necessarily finished that step's job, so any
 * fixture that seeds `hitl_pending` needs the matching job record too — that is
 * what lets run-step heal the cursor forward instead of re-running the step.
 * Same shape as the stuck-job fixture in runStep.route.test.ts.
 */
function seedSucceededJob(taskId: string, stepId: string) {
  const jobsDir = path.join(root, '.home', 'jobs')
  fs.mkdirSync(jobsDir, { recursive: true })
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  fs.writeFileSync(
    path.join(jobsDir, `${id}.json`),
    JSON.stringify({
      id,
      status: 'succeeded',
      runnerId: RUNNER_ID,
      agentRef: ' ',
      workspace: path.join(root, 'tasks', taskId),
      userPrompt: 'do the thing',
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      pid: null,
      metadata: { taskId, pipelineStepId: stepId, devTeamRoot: root },
    }),
    'utf8',
  )
  return id
}

/** Edit the pipeline the way the user does — through the real editor endpoint. */
async function writePipeline(steps: StepSpec[], taskId?: string) {
  const res = await app.request('/api/pipeline-config-write', {
    method: 'POST',
    body: JSON.stringify({
      scope: taskId ? 'task' : 'global',
      ...(taskId ? { taskId } : {}),
      pipeline: pipelineBody(steps),
    }),
  })
  expect(res.status).toBe(200)
  return res
}

async function runStep(taskId: string, body: Record<string, unknown> = {}) {
  return app.request(`/api/tasks/${taskId}/run-step`, {
    method: 'POST',
    body: JSON.stringify({ runnerId: RUNNER_ID, ...body }),
  })
}

/** Run the current step and wait for it (plus any auto-chained steps) to finish. */
async function runAndSettle(taskId: string, body: Record<string, unknown> = {}) {
  const res = await runStep(taskId, body)
  expect(res.status).toBe(201)
  const { job } = await res.json()
  await settle(job.id)
  return job
}

/** The `/api/tasks` row the dashboard polls — the proxy for "what the UI shows". */
async function taskRow(taskId: string) {
  const res = await app.request('/api/tasks')
  expect(res.status).toBe(200)
  const body = await res.json()
  return body.tasks.find((t: any) => t.task_id === taskId)
}

/**
 * INV-2 as a single assertion: the projection, the pipeline nodes the UI derives
 * from it, and the run-step guard must all agree on which gate blocks.
 * Returns the row so callers can assert further.
 */
async function expectConsistent(
  taskId: string,
  expectedGate: string | null,
  // Gate ids are not required to be unique; when the same id sits on two steps
  // the UI legitimately marks both (see TC-16), so only the cursor's node is
  // asserted there.
  //
  // `untrusted`: the task's pipeline.yaml does not parse, so there is no
  // trustworthy step list to draw a node from. The server keeps blocking (a
  // guessed release could skip a real approval), and the invariant degrades to
  // "the UI is TOLD the pipeline is broken" — a signalled block the user can
  // act on, not the silent deadlock TC-01 fixes.
  opts: { uniqueGates?: boolean; untrusted?: boolean } = {},
) {
  const { uniqueGates = true, untrusted = false } = opts
  const row = await taskRow(taskId)
  expect(row.hitl_pending).toBe(expectedGate)
  if (untrusted) {
    expect(row.pipeline?.untrusted).toBe(true)
    return row
  }
  expect(row.pipeline?.untrusted).toBe(false)
  // The UI draws a `waiting` node by matching `hitl_pending` against each step's
  // gate: at least one node when blocked, none at all otherwise.
  const waitingSteps = (row.pipeline?.steps ?? []).filter(
    (s: any) => s.hitl?.gate_id && s.hitl.gate_id === row.hitl_pending,
  )
  if (!expectedGate) {
    expect(waitingSteps.length).toBe(0)
    return row
  }
  if (uniqueGates) expect(waitingSteps.length).toBe(1)
  // A node must sit on the step the cursor is on, so the button the user sees is
  // the one the approve API accepts.
  expect(waitingSteps.map((s: any) => s.id)).toContain(row.current_phase)
  return row
}

async function approve(taskId: string, gateId: string, action = 'approve') {
  const row = await taskRow(taskId)
  return app.request(`/api/task-state?id=${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ action, gate_id: gateId, mtime: row.state_mtime }),
  })
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-gate-pipeline-change-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  registerProvider(stubProvider)
  upsertConnection({
    id: 'stub-conn-gate-change',
    kind: 'local-console',
    providerId: PROVIDER_ID,
    cliPath: 'stub',
  })
  upsertRunner({ id: RUNNER_ID, connectionId: 'stub-conn-gate-change', config: {} })
  // Global default = P_gate. Tasks that need their own shape write a task-scope
  // override; the two global-scope cases restore this in a `finally`.
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    JSON.stringify(pipelineBody(P_GATE)),
    'utf8',
  )
  app = await createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})
afterEach(() => {
  gated = false
  resolveGate = null
})

describe('gate vs. changed pipeline — main scenario', () => {
  // TC-01 — the reported bug, end to end.
  test('gate → run → pipeline edited to drop the gate → next step runs', async () => {
    seedTask('T1', { current_phase: 'designer' })
    await writePipeline(P_GATE, 'T1')

    // (1) designer finishes → its gate opens and blocks implementer.
    await runAndSettle('T1')
    await waitForState('T1', (s) => s.hitl_pending === 'g1')
    const blocked = await expectConsistent('T1', 'g1')
    expect(blocked.current_phase).toBe('designer')

    // (2) run-step is refused while the gate is genuinely live — unchanged.
    expect((await runStep('T1')).status).toBe(400)

    // (3) user removes every gate. The very next poll must stop advertising a
    // gate nobody can approve — no run needed. This is the assertion that
    // catches the original bug; passing only at (4) still violates INV-2.
    await writePipeline(P_NOGATE, 'T1')
    await expectConsistent('T1', null)

    // (4) and the step actually runs.
    const job = await runAndSettle('T1')
    expect(job.metadata.pipelineStepId).toBe('implementer')
    // Self-heal must be persisted, not just patched in memory.
    expect(readStateFile('T1').hitl_pending).toBeNull()
    await waitForState('T1', (s) => s.current_phase === 'completed')
  })

  // TC-02 / TC-23 — a task stuck since before the fix, and stability afterwards.
  test('a task already stuck on a deleted gate escapes without hand-editing state', async () => {
    // Fixture = "this task has been in that state since before the fix".
    seedTask('T2', { current_phase: 'designer', hitl_pending: 'g1' })
    seedSucceededJob('T2', 'designer')
    await writePipeline(P_NOGATE, 'T2')

    await expectConsistent('T2', null)
    const job = await runAndSettle('T2')
    expect(job.metadata.pipelineStepId).toBe('implementer')

    // Idempotent: the dead gate must not come back to life on later reads/runs.
    await waitForState('T2', (s) => s.current_phase === 'completed')
    await expectConsistent('T2', null)
    expect((await runStep('T2')).status).toBe(400) // 400 = pipeline completed, not a gate
    await expectConsistent('T2', null)
  })

  // TC-22 — must not be specific to task-scope overrides.
  test('works when the GLOBAL pipeline is the one that changed', async () => {
    const globalFile = path.join(root, 'pipeline.yaml')
    const original = fs.readFileSync(globalFile, 'utf8')
    try {
      seedTask('T22', { current_phase: 'designer', hitl_pending: 'g1' })
      seedSucceededJob('T22', 'designer')
      await expectConsistent('T22', 'g1') // still gated by the global shape

      await writePipeline(P_NOGATE) // scope: global
      await expectConsistent('T22', null)
      const job = await runAndSettle('T22')
      expect(job.metadata.pipelineStepId).toBe('implementer')
    } finally {
      fs.writeFileSync(globalFile, original, 'utf8')
    }
  })
})

describe('INV-1 — a live gate must never be walked past', () => {
  // TC-03 — positive control. If this goes red the fix over-cleared; do not land.
  test('untouched pipeline keeps blocking, and the gate stays approvable', async () => {
    seedTask('T3', { current_phase: 'designer', hitl_pending: 'g1' })
    await writePipeline(P_GATE, 'T3')

    expect((await runStep('T3')).status).toBe(400)
    await expectConsistent('T3', 'g1')
    // Blocked ⇒ approvable (INV-2).
    expect((await approve('T3', 'g1')).status).toBe(200)
    expect(readStateFile('T3').current_phase).toBe('implementer')
  })

  // TC-04 — "the pipeline changed" is not on its own a reason to drop a gate.
  test('editing OTHER steps leaves the gate in force', async () => {
    seedTask('T4', { current_phase: 'designer', hitl_pending: 'g1' })
    await writePipeline(P_GATE, 'T4')

    // Same gate on `designer`, but a step appended and `reviewer` renamed away.
    await writePipeline(
      [{ id: 'fetch' }, { id: 'designer', gate: 'g1' }, { id: 'implementer' }, { id: 'qa' }],
      'T4',
    )
    expect((await runStep('T4')).status).toBe(400)
    await expectConsistent('T4', 'g1')
    expect((await approve('T4', 'g1')).status).toBe(200)
    const job = await runAndSettle('T4')
    expect(job.metadata.pipelineStepId).toBe('implementer')
  })

  // TC-05 — the auto-advance chain is where the bug lived, so it is the riskiest
  // thing to regress in the dangerous direction.
  test('the auto-chain stops at a live gate instead of running through it', async () => {
    seedTask('T5', { current_phase: 'fetch' })
    await writePipeline(P_GATE, 'T5')

    await runAndSettle('T5', { targetStepId: 'reviewer' })
    await waitForState('T5', (s) => s.hitl_pending === 'g1')
    await sleep(50)
    const state = readStateFile('T5')
    expect(state.current_phase).toBe('designer')
    expect(state.hitl_pending).toBe('g1')
    // implementer/reviewer must not have been submitted behind the gate.
    const ran = listJobs(100)
      .filter((j) => j.metadata?.taskId === 'T5')
      .map((j) => j.metadata?.pipelineStepId)
    expect(ran).not.toContain('implementer')
    expect(ran).not.toContain('reviewer')
    await expectConsistent('T5', 'g1')
  })

  // TC-06 — the other side of the same chain: once the gate is gone the chain
  // must resume, not sit there silently.
  test('the chain resumes after the gate it stopped on is removed', async () => {
    seedTask('T6', { current_phase: 'designer', hitl_pending: 'g1' })
    seedSucceededJob('T6', 'designer')
    await writePipeline(P_NOGATE, 'T6')

    await runAndSettle('T6', { targetStepId: 'reviewer' })
    // Chain stops submitting at the target, but `reviewer` is last so finishing
    // it moves the cursor on to `completed`.
    await waitForState('T6', (s) => s.current_phase === 'completed')
    const ran = listJobs(100)
      .filter((j) => j.metadata?.taskId === 'T6')
      .map((j) => j.metadata?.pipelineStepId)
    expect(ran).toContain('implementer')
    await expectConsistent('T6', null)
  })

  // TC-15 — clearing one gate must not clear the others.
  test('removing one gate leaves the remaining gates in force', async () => {
    seedTask('T15', { current_phase: 'designer', hitl_pending: 'g1' })
    seedSucceededJob('T15', 'designer')
    await writePipeline(
      [
        { id: 'fetch' },
        { id: 'designer', gate: 'g1' },
        { id: 'implementer', gate: 'g2' },
        { id: 'reviewer' },
      ],
      'T15',
    )
    await expectConsistent('T15', 'g1')

    // Drop g1, keep g2.
    await writePipeline(
      [
        { id: 'fetch' },
        { id: 'designer' },
        { id: 'implementer', gate: 'g2' },
        { id: 'reviewer' },
      ],
      'T15',
    )
    await expectConsistent('T15', null)

    const job = await runAndSettle('T15')
    expect(job.metadata.pipelineStepId).toBe('implementer')
    await waitForState('T15', (s) => s.hitl_pending === 'g2')
    await expectConsistent('T15', 'g2')
    expect((await runStep('T15')).status).toBe(400)
    expect((await approve('T15', 'g2')).status).toBe(200)
  })

  // TC-16 — gate ids are not required to be unique; one approval must not
  // consume both occurrences.
  test('the same gate id on two steps must be approved twice', async () => {
    seedTask('T16', { current_phase: 'designer', hitl_pending: 'g1' })
    await writePipeline(
      [
        { id: 'fetch' },
        { id: 'designer', gate: 'g1' },
        { id: 'implementer', gate: 'g1' },
        { id: 'reviewer' },
      ],
      'T16',
    )
    expect((await approve('T16', 'g1')).status).toBe(200)
    expect(readStateFile('T16').current_phase).toBe('implementer')

    await runAndSettle('T16')
    await waitForState('T16', (s) => s.hitl_pending === 'g1')
    const row = await expectConsistent('T16', 'g1', { uniqueGates: false })
    expect(row.current_phase).toBe('implementer')
    expect((await runStep('T16')).status).toBe(400)
  })
  // TC-26 — the pipeline file can stop parsing without anyone touching the
  // editor: a hand edit, a merge conflict marker, a tool writing it. The atomic
  // write added in this change only closes the editor's own torn-write path.
  // `loadPipelineConfig` then returns the GLOBAL steps, which here declare no
  // gate — so anything that reads "gate removed" off them walks the task past a
  // human approval, silently, with the ⏸ badge gone too.
  test('a task pipeline.yaml that does not parse holds the gate instead of guessing', async () => {
    const globalFile = path.join(root, 'pipeline.yaml')
    try {
      // Global = no gate, so a wrong fallback is unmistakable.
      fs.writeFileSync(globalFile, JSON.stringify(pipelineBody(P_NOGATE)), 'utf8')
      seedTask('T26', { current_phase: 'designer', hitl_pending: 'g1' })
      await writePipeline(P_GATE, 'T26')
      await expectConsistent('T26', 'g1')

      // Straight to disk, bypassing the editor endpoint: unbalanced brace.
      fs.writeFileSync(
        path.join(root, 'tasks', 'T26', 'pipeline.yaml'),
        'version: 1\nsteps:\n  - id: designer\n    hitl: { mode: manual, gate_id: g1\n',
        'utf8',
      )

      expect((await runStep('T26')).status).toBe(400)
      expect(readStateFile('T26').hitl_pending).toBe('g1')
      // Nothing was rewritten on the way to that refusal.
      expect(readStateFile('T26').gate_reconciled_at).toBeUndefined()
      await expectConsistent('T26', 'g1', { untrusted: true })

      // Fix the file and the ordinary flow resumes — the hold is not sticky.
      await writePipeline(P_NOGATE, 'T26')
      await expectConsistent('T26', null)
      const job = await runAndSettle('T26')
      expect(job.metadata.pipelineStepId).toBe('designer')
    } finally {
      fs.writeFileSync(globalFile, JSON.stringify(pipelineBody(P_GATE)), 'utf8')
    }
  })

  // Two ways out of the hold above, so it is never a dead end. Repair is the
  // explicit override: unlike reconcile it judges against the pipeline it CAN
  // resolve, and releases when that one declares no gate at the cursor.
  test('Repair overrides the hold when the resolvable pipeline has no such gate', async () => {
    const globalFile = path.join(root, 'pipeline.yaml')
    try {
      fs.writeFileSync(globalFile, JSON.stringify(pipelineBody(P_NOGATE)), 'utf8')
      seedTask('T26b', { current_phase: 'designer', hitl_pending: 'g1' })
      await writePipeline(P_GATE, 'T26b')
      fs.writeFileSync(path.join(root, 'tasks', 'T26b', 'pipeline.yaml'), 'steps: [ {', 'utf8')

      expect((await runStep('T26b')).status).toBe(400)
      const repair = await app.request('/api/tasks/T26b/repair-state', { method: 'POST' })
      expect(repair.status).toBe(200)
      expect(readStateFile('T26b').hitl_pending).toBeNull()
    } finally {
      fs.writeFileSync(globalFile, JSON.stringify(pipelineBody(P_GATE)), 'utf8')
    }
  })

  // The other way out, and the one that works even when the fallback does still
  // declare the gate: saving from the editor overwrites the unparseable file.
  test('re-saving the pipeline from the editor clears the hold', async () => {
    seedTask('T26c', { current_phase: 'designer', hitl_pending: 'g1' })
    await writePipeline(P_GATE, 'T26c')
    fs.writeFileSync(path.join(root, 'tasks', 'T26c', 'pipeline.yaml'), 'steps: [ {', 'utf8')
    expect((await runStep('T26c')).status).toBe(400)

    await writePipeline(P_NOGATE, 'T26c')
    await expectConsistent('T26c', null)
    expect((await runStep('T26c')).status).toBe(201)
  })
})

describe('INV-2 — blocked ⇔ approvable', () => {
  // TC-07 rows a/b/e/f/g as one table: the projection, the node count and the
  // run-step guard must never disagree.
  const rows: Array<{
    name: string
    pending: unknown
    steps: StepSpec[]
    expected: string | null
  }> = [
    { name: 'a: gate live at the cursor', pending: 'g1', steps: P_GATE, expected: 'g1' },
    { name: 'b: gate deleted from the pipeline', pending: 'g1', steps: P_NOGATE, expected: null },
    { name: 'e: nothing pending', pending: null, steps: P_GATE, expected: null },
    { name: 'f: legacy true, gate still there', pending: true, steps: P_GATE, expected: 'g1' },
    { name: 'g: legacy true, no gate left', pending: true, steps: P_NOGATE, expected: null },
  ]

  for (const [i, row] of rows.entries()) {
    test(`row ${row.name}`, async () => {
      const taskId = `T7${i}`
      seedTask(taskId, { current_phase: 'designer', hitl_pending: row.pending })
      await writePipeline(row.steps, taskId)

      await expectConsistent(taskId, row.expected)
      if (row.expected) {
        // Blocked: run-step refuses AND the approve call for that gate succeeds.
        expect((await runStep(taskId)).status).toBe(400)
        expect((await approve(taskId, row.expected)).status).toBe(200)
      } else {
        // Not blocked: a job is actually created.
        const res = await runStep(taskId)
        expect(res.status).toBe(201)
        await settle((await res.json()).job.id)
      }
    })
  }

  // TC-09 — the branch this product chose: a gate moved to another step no
  // longer blocks the step the cursor is on, and takes effect at its new home.
  test('a gate moved to a later step stops blocking here and applies there', async () => {
    seedTask('T9', { current_phase: 'designer', hitl_pending: 'g1' })
    seedSucceededJob('T9', 'designer')
    await writePipeline(P_GATE, 'T9')
    await expectConsistent('T9', 'g1')

    await writePipeline(
      [
        { id: 'fetch' },
        { id: 'designer' },
        { id: 'implementer', gate: 'g1' },
        { id: 'reviewer' },
      ],
      'T9',
    )
    // `g1` still exists in the pipeline, but not at the cursor: keeping it would
    // block while drawing the approve node on `implementer` — the exact
    // inconsistency INV-2 forbids.
    await expectConsistent('T9', null)

    const job = await runAndSettle('T9')
    expect(job.metadata.pipelineStepId).toBe('implementer')
    await waitForState('T9', (s) => s.hitl_pending === 'g1')
    const row = await expectConsistent('T9', 'g1')
    expect(row.current_phase).toBe('implementer')
  })

  // TC-10 — same step, renamed gate.
  test('renaming the gate on the waiting step drops the old id cleanly', async () => {
    seedTask('T10', { current_phase: 'designer', hitl_pending: 'g1' })
    await writePipeline(P_GATE, 'T10')
    await writePipeline(
      [{ id: 'fetch' }, { id: 'designer', gate: 'g2' }, { id: 'implementer' }, { id: 'reviewer' }],
      'T10',
    )
    // The cursor's step declares `g2`, and the stored pending id is `g1` — not
    // the same gate, so it is not the one blocking.
    await expectConsistent('T10', null)

    // A stale tab approving `g1` gets a clear 4xx (never a 500) and must not
    // corrupt the state.
    const before = await taskRow('T10')
    const res = await approve('T10', 'g1')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBeTruthy()
    const after = await taskRow('T10')
    expect(after.hitl_pending).toBe(before.hitl_pending)
    expect(after.current_phase).toBe(before.current_phase)

    // Running `designer` again opens `g2` — the gate that now exists.
    const job = await runAndSettle('T10')
    expect(job.metadata.pipelineStepId).toBe('designer')
    await waitForState('T10', (s) => s.hitl_pending === 'g2')
    await expectConsistent('T10', 'g2')
  })

  // TC-11 — legacy boolean state reproduces the bug's symptom even with the
  // pipeline untouched, so it gets its own end-to-end case.
  test('legacy hitl_pending: true blocks AND is approvable', async () => {
    seedTask('T11', { current_phase: 'designer', hitl_pending: true })
    await writePipeline(P_GATE, 'T11')

    expect((await runStep('T11')).status).toBe(400)
    // Normalised to the gate id so the UI can match it to a node at all.
    await expectConsistent('T11', 'g1')
    expect((await approve('T11', 'g1')).status).toBe(200)
    const job = await runAndSettle('T11')
    expect(job.metadata.pipelineStepId).toBe('implementer')
  })

  // TC-20 — stale tab acting on a gate that no longer exists.
  test('approve/reject on a removed gate is 4xx and leaves the task runnable', async () => {
    seedTask('T20', { current_phase: 'designer', hitl_pending: 'g1' })
    await writePipeline(P_NOGATE, 'T20')

    for (const action of ['approve', 'reject']) {
      const res = await approve('T20', 'g1', action)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      await expectConsistent('T20', null)
    }
    const res = await runStep('T20')
    expect(res.status).toBe(201)
    await settle((await res.json()).job.id)
  })

  // TC-21 — the pipeline editor refuses completed/archived tasks, so the way out
  // must not depend on the user being able to edit the pipeline.
  test('a completed task never shows a leftover gate', async () => {
    seedTask('T21', { current_phase: 'completed', hitl_pending: 'g1' })
    await expectConsistent('T21', null)
  })

  // TC-18 — intersects the pre-existing "cursor lost from the pipeline" flow that
  // the Repair button owns; must not 500 and must not regress Repair.
  test('a pipeline that no longer contains the cursor step: no phantom gate, Repair still works', async () => {
    seedTask('T18', { current_phase: 'designer', hitl_pending: 'g1' })
    await writePipeline([{ id: 'alpha' }, { id: 'beta' }], 'T18')

    const row = await expectConsistent('T18', null)
    expect(row.current_phase).toBe('designer')

    const repair = await app.request('/api/tasks/T18/repair-state', { method: 'POST' })
    expect(repair.status).toBe(200)
    const repaired = readStateFile('T18')
    expect(repaired.current_phase).toBe('completed')
    expect(repaired.hitl_pending).toBeNull()
  })
})

describe('adding a gate back', () => {
  // TC-13 — a gate added to a step not yet run takes effect on its next success.
  test('a gate added to an upcoming step takes effect', async () => {
    seedTask('T13', { current_phase: 'designer' })
    await writePipeline(P_NOGATE, 'T13')
    await writePipeline(
      [{ id: 'fetch' }, { id: 'designer', gate: 'g9' }, { id: 'implementer' }, { id: 'reviewer' }],
      'T13',
    )

    await runAndSettle('T13')
    await waitForState('T13', (s) => s.hitl_pending === 'g9')
    await expectConsistent('T13', 'g9')
    expect((await runStep('T13')).status).toBe(400)
    expect((await approve('T13', 'g9')).status).toBe(200)
    const job = await runAndSettle('T13')
    expect(job.metadata.pipelineStepId).toBe('implementer')
  })

  // TC-14 — no retroactive gating: adding a gate to an already-finished step must
  // not yank the cursor backwards.
  test('a gate added to a step already passed is not retroactive', async () => {
    seedTask('T14', { current_phase: 'implementer' })
    await writePipeline(
      [{ id: 'fetch' }, { id: 'designer', gate: 'g9' }, { id: 'implementer' }, { id: 'reviewer' }],
      'T14',
    )

    await expectConsistent('T14', null)
    const job = await runAndSettle('T14')
    expect(job.metadata.pipelineStepId).toBe('implementer')
  })

  // TC-17 — a gate on the last step: blocked must still mean approvable, and
  // approving finishes the task.
  test('a gate on the final step is approvable and completes the task', async () => {
    seedTask('T17', { current_phase: 'reviewer' })
    await writePipeline(
      [{ id: 'fetch' }, { id: 'designer' }, { id: 'implementer' }, { id: 'reviewer', gate: 'g1' }],
      'T17',
    )

    await runAndSettle('T17')
    await waitForState('T17', (s) => s.hitl_pending === 'g1')
    await expectConsistent('T17', 'g1')
    expect((await approve('T17', 'g1')).status).toBe(200)
    expect(readStateFile('T17').current_phase).toBe('completed')
  })
})

describe('concurrency and audit trail', () => {
  // TC-19 — editing the pipeline while the step's job runs must not lose the job
  // result (INV-4) nor leave the dead gate blocking.
  test('editing the pipeline mid-job keeps the job result and unblocks the task', async () => {
    gated = true
    seedTask('T19', { current_phase: 'designer' })
    await writePipeline(P_GATE, 'T19')

    const res = await runStep('T19')
    expect(res.status).toBe(201)
    const { job } = await res.json()
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)
    expect(loadJob(job.id)?.status).toBe('running')

    // User saves a gate-less pipeline while the job is still executing.
    await writePipeline(P_NOGATE, 'T19')

    gated = false
    resolveGate?.()
    const finished = await settle(job.id)
    expect(finished.status).toBe('succeeded') // INV-4: result not lost

    // The gate-less shape wins: the chain-on-success hook must advance rather
    // than open the gate that no longer exists.
    await waitForState('T19', (s) => s.current_phase !== 'designer')
    await expectConsistent('T19', null)
  })

  // TC-25 — the audit trail must not read as "a human approved this".
  test('cancelling a gate because the pipeline changed is recorded with its reason', async () => {
    const events: any[] = []
    const off = on('hitl.resolved', (e: any) => {
      if (e.payload?.taskId === 'T25') events.push(e.payload)
    })
    try {
      seedTask('T25', { current_phase: 'designer', hitl_pending: 'g1' })
      await writePipeline(P_NOGATE, 'T25')
      await runAndSettle('T25')

      const cancelled = events.find((e) => e.reason === 'pipeline_changed')
      expect(cancelled).toBeTruthy()
      expect(cancelled.gateId).toBe('g1')
      expect(cancelled.action).toBe('cancelled')
      // Nothing may claim this was approved or rejected by a person.
      expect(events.some((e) => e.action === 'approve' || e.action === 'reject')).toBe(false)
      // And the state file carries the audit stamp.
      expect(typeof readStateFile('T25').gate_reconciled_at).toBe('string')
    } finally {
      off()
    }
  })
})
