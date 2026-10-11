import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _resetEventBusForTest, on } from '../../../../src/backend/events/index.js'
import {
  _resetOrchestratorForTest,
  applyDecision,
  liveJobsOfTask,
  sweepStuckTasks,
} from '../../../../src/features/orchestrator/business/decisionLoop.js'
import { registerProvider, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

/**
 * Tfb77cf90-P10 (#449) — characterization quy tắc "job thuộc task" ở cả ba nơi
 * đang dùng nó (`liveJobsOfTask`, `respawn`, `sweepStuckTasks`), chốt TRƯỚC khi
 * gom về một hàm:
 *
 *   - job thiếu `devTeamRoot` (job cũ) ⇒ coi như thuộc root đang xét;
 *   - job mang `devTeamRoot` của root khác ⇒ KHÔNG thuộc task, dù trùng `taskId`.
 *
 * Bề mặt chấm: event `orchestrator.dispatched` / `orchestrator.halted` phát ra.
 */

const PROVIDER_ID = 'stub-orch-job-ownership'
const RUNNER_ID = 'stub-runner-orch-job-ownership'

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(): Promise<ExecuteResult> {
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let home: string
let root: string
const savedEnv = { ...process.env }

interface Seen {
  type: string
  payload: Record<string, any>
}
const seen: Seen[] = []

const dispatched = (taskId: string) =>
  seen.filter((e) => e.type === 'orchestrator.dispatched' && e.payload.taskId === taskId).map((e) => e.payload)
const haltReasons = (taskId: string) =>
  seen.filter((e) => e.type === 'orchestrator.halted' && e.payload.taskId === taskId).map((e) => String(e.payload.reason))

function writePipeline() {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      'orchestrator: { enabled: true, agent: "a:orch" }',
      'steps:',
      '  - { id: implementer, name: Implement, agent: "a:impl" }',
      '  - { id: reviewer, name: Review, agent: "a:rev" }',
    ].join('\n'),
    'utf8',
  )
}

function seedTask(taskId: string, state: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), '# r\n', 'utf8')
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, orchestrator_enabled: true, ...state }),
    'utf8',
  )
}

/**
 * Ghi thẳng một job record. `metadata` giữ NGUYÊN như truyền vào — không tự
 * thêm `devTeamRoot`, vì chính sự có/không của khoá đó là thứ đang chấm.
 */
function writeJob(id: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      status: 'succeeded',
      runnerId: 'r',
      agentRef: 'a',
      workspace: path.join(root, 'tasks', String(metadata.taskId ?? 'T')),
      createdAt: new Date().toISOString(),
      metadata,
      ...extra,
    }),
    'utf8',
  )
  return id
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-owner-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-orch-owner', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' } as any)
  upsertRunner({ id: RUNNER_ID, connectionId: 'stub-conn-orch-owner', config: {} } as any)
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-owner-root-'))
  _resetEventBusForTest()
  _resetOrchestratorForTest()
  seen.length = 0
  on('*', (e) => {
    seen.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, any> })
  })
  writePipeline()
})
afterEach(() => {
  _resetEventBusForTest()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('liveJobsOfTask — job đang sống của task', () => {
  test('job thiếu devTeamRoot ⇒ thuộc task; job root khác ⇒ không', () => {
    writeJob('own-live-legacy', { taskId: 'L1' }, { status: 'running' })
    writeJob('own-live-other', { taskId: 'L1', devTeamRoot: `${root}-other` }, { status: 'running' })
    writeJob('own-live-mine', { taskId: 'L1', devTeamRoot: root }, { status: 'queued' })
    writeJob('own-live-done', { taskId: 'L1', devTeamRoot: root }, { status: 'succeeded' })

    const ids = liveJobsOfTask(root, 'L1').map((j) => j.id).sort()
    expect(ids).toEqual(['own-live-legacy', 'own-live-mine'])
  })
})

describe('respawn — "step đã từng chạy xong" chỉ đếm job thuộc task', () => {
  const respawn = (taskId: string) =>
    applyDecision({ root, taskId, projectId: '' }, { action: 'respawn', stepId: 'implementer' }, { completed: false })

  test('job xong thiếu devTeamRoot (job cũ) ⇒ được tính, respawn chạy', async () => {
    seedTask('RS1', { current_phase: 'reviewer' })
    writeJob('own-rs1', { taskId: 'RS1', pipelineStepId: 'implementer' })

    await respawn('RS1')
    expect(haltReasons('RS1')).toEqual([])
    expect(dispatched('RS1')).toEqual([
      expect.objectContaining({ stepId: 'implementer', action: 'respawn', reason: 'respawn' }),
    ])
  })

  test('job xong của root khác (trùng taskId) ⇒ không tính, halt', async () => {
    seedTask('RS2', { current_phase: 'reviewer' })
    writeJob('own-rs2', { taskId: 'RS2', devTeamRoot: `${root}-other`, pipelineStepId: 'implementer' })

    await respawn('RS2')
    expect(dispatched('RS2')).toEqual([])
    expect(haltReasons('RS2')).toEqual(['respawn failed: step implementer has no finished job yet'])
  })
})

describe('sweepStuckTasks — "job gần nhất" chỉ xét job thuộc task', () => {
  test('job xong của bước hiện tại thiếu devTeamRoot ⇒ được tính, cursor đi tiếp', async () => {
    seedTask('SW1', { current_phase: 'implementer' })
    writeJob('own-sw1', { taskId: 'SW1', pipelineStepId: 'implementer' })

    expect(await sweepStuckTasks(root, 'p1')).toBe(1)
    expect(dispatched('SW1')).toEqual([expect.objectContaining({ stepId: 'reviewer', reason: 'advance' })])
  })

  test('job xong của root khác (trùng taskId) ⇒ không tính, nối lại bước hiện tại', async () => {
    seedTask('SW2', { current_phase: 'implementer' })
    writeJob('own-sw2', { taskId: 'SW2', devTeamRoot: `${root}-other`, pipelineStepId: 'implementer' })

    expect(await sweepStuckTasks(root, 'p1')).toBe(1)
    expect(dispatched('SW2')).toEqual([expect.objectContaining({ stepId: 'implementer', reason: 'sweep_resume' })])
  })
})
