import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runTaskStep } from '../../../../src/features/monitor/business/tasks/runStep.js'
import {
  listJobs,
  loadJob,
  registerProvider,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// Orchestrator soạn brief cho MỘT step cụ thể rồi nhờ `runTaskStep` chạy step
// đó. Nếu step thực sự chạy không phải step đã soạn brief thì cả tính năng nói
// dối: event nói một đằng, job chạy một nẻo.
//
// Hai chế độ hỏng được phủ ở đây:
//   1. lượt `review_retry` — cursor vừa lùi về `implementer`, nhưng lượt
//      implementer TRƯỚC đó vẫn còn `succeeded`, nên đường tự-chữa của
//      `runTaskStep` sẽ đẩy cursor lên `reviewer` và chạy nhầm reviewer.
//      Đó đúng là đường implementer ↔ reviewer mà đề bài yêu cầu.
//   2. `start <stepId>` trỏ về phía sau — phải bị từ chối tường minh để
//      orchestrator halt, không được lặng lẽ chạy step khác.

const PROVIDER_ID = 'stub-orch-pin'
let home: string
let root: string
const savedEnv = { ...process.env }

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(_req: ExecuteRequest): Promise<ExecuteResult> {
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

function seedTask(taskId: string, phase: string, extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), '# request thô\n', 'utf8')
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: phase, orchestrator_enabled: true, ...extra }),
    'utf8',
  )
}

/** Một job của `stepId` đã kết thúc thành công — bối cảnh của lượt review-retry. */
function seedSucceededJob(taskId: string, stepId: string) {
  const job = submitJob({
    runnerId: 'stub-runner-orch-pin',
    agentRef: '',
    workspace: path.join(root, 'tasks', taskId),
    metadata: {
      devTeamRoot: root,
      taskId,
      pipelineStepId: stepId,
      // Vé đi qua lớp chặn đồng bộ — task này đang bật điều phối.
      orchestratorDispatch: true,
    },
  })
  const file = path.join(home, 'jobs', `${job.id}.json`)
  fs.writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), status: 'succeeded', finishedAt: new Date().toISOString() }),
    'utf8',
  )
  return job.id
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-pin-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-pin-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-orch-pin', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-orch-pin', connectionId: 'stub-conn-orch-pin', config: {} })
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      'orchestrator: { enabled: true, agent: "a:orch" }',
      'steps:',
      '  - { id: investigator, name: Investigate, agent: "a:inv" }',
      '  - { id: implementer, name: Implement, agent: "a:impl" }',
      '  - { id: reviewer, name: Review, agent: "a:rev" }',
    ].join('\n'),
    'utf8',
  )
})

describe('dispatch của orchestrator chạy ĐÚNG step đã soạn brief', () => {
  test('review-retry: cursor lùi về implementer dù implementer từng succeeded ⇒ chạy implementer', async () => {
    seedTask('R1', 'implementer')
    seedSucceededJob('R1', 'implementer')

    const res = await runTaskStep(root, 'P1', 'R1', {
      origin: 'orchestrator',
      targetStepId: 'implementer',
      skipIntermediate: true,
      userPrompt: 'brief cho implementer',
    })

    if ('error' in res) throw new Error(`kỳ vọng chạy được: ${res.error}`)
    expect(res.stepId).toBe('implementer')
    expect(res.job.metadata?.pipelineStepId).toBe('implementer')
    // Cursor KHÔNG được tự nhảy lên reviewer.
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'R1.json'), 'utf8'))
    expect(state.current_phase).toBe('implementer')
  })

  test('brief của orchestrator thay request.md thô làm userPrompt', async () => {
    seedTask('R2', 'implementer')
    const res = await runTaskStep(root, 'P1', 'R2', {
      origin: 'orchestrator',
      targetStepId: 'implementer',
      skipIntermediate: true,
      userPrompt: '## Việc của bạn\n\nsửa theo phản hồi của reviewer',
    })
    if ('error' in res) throw new Error(res.error)
    expect(res.job.userPrompt).toContain('sửa theo phản hồi của reviewer')
    expect(res.job.userPrompt).not.toBe('# request thô\n')
  })

  test('job dispatch mang vé orchestratorDispatch (đi qua được lớp chặn đồng bộ)', async () => {
    seedTask('R3', 'implementer')
    const res = await runTaskStep(root, 'P1', 'R3', {
      origin: 'orchestrator',
      targetStepId: 'implementer',
      skipIntermediate: true,
      userPrompt: 'brief',
    })
    if ('error' in res) throw new Error(res.error)
    expect(res.job.metadata?.orchestratorDispatch).toBe(true)
  })

  test('start trỏ về step PHÍA SAU ⇒ từ chối tường minh, không chạy step nào', async () => {
    seedTask('R4', 'reviewer')
    const before = listJobs(200).filter((j) => j.metadata?.taskId === 'R4').length

    const res = await runTaskStep(root, 'P1', 'R4', {
      origin: 'orchestrator',
      targetStepId: 'investigator',
      skipIntermediate: true,
      userPrompt: 'brief cho investigator',
    })

    expect(res.ok).toBe(false)
    if (!('error' in res)) throw new Error('kỳ vọng bị từ chối')
    expect(res.status).toBe(400)
    expect(listJobs(200).filter((j) => j.metadata?.taskId === 'R4').length).toBe(before)
  })

  test('start nhảy tới step PHÍA TRƯỚC ⇒ chạy đúng step đó và đẩy cursor tới đó', async () => {
    seedTask('R5', 'investigator')
    const res = await runTaskStep(root, 'P1', 'R5', {
      origin: 'orchestrator',
      targetStepId: 'reviewer',
      skipIntermediate: true,
      userPrompt: 'brief cho reviewer',
    })
    if ('error' in res) throw new Error(res.error)
    expect(res.stepId).toBe('reviewer')
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'R5.json'), 'utf8'))
    expect(state.current_phase).toBe('reviewer')
  })
})

describe('đường chạy tay vẫn giữ nguyên hành vi tự-chữa', () => {
  test('không pin ⇒ job succeeded của bước hiện tại vẫn đẩy cursor như cũ', async () => {
    // Tắt điều phối để `assertStartAllowed` cho phép `origin: manual`.
    fs.writeFileSync(
      path.join(root, 'pipeline.yaml'),
      [
        'version: 1',
        'steps:',
        '  - { id: investigator, name: Investigate, agent: "a:inv" }',
        '  - { id: implementer, name: Implement, agent: "a:impl" }',
        '  - { id: reviewer, name: Review, agent: "a:rev" }',
      ].join('\n'),
      'utf8',
    )
    seedTask('M1', 'implementer', { orchestrator_enabled: false })
    const done = submitJob({
      runnerId: 'stub-runner-orch-pin',
      agentRef: '',
      workspace: path.join(root, 'tasks', 'M1'),
      metadata: { devTeamRoot: root, taskId: 'M1', pipelineStepId: 'implementer' },
    })
    const file = path.join(home, 'jobs', `${done.id}.json`)
    for (let i = 0; i < 200 && loadJob(done.id)?.status !== 'succeeded'; i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    fs.writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), status: 'succeeded', finishedAt: new Date().toISOString() }),
      'utf8',
    )

    const res = await runTaskStep(root, 'P1', 'M1', {})
    if ('error' in res) throw new Error(res.error)
    // Hành vi cũ: nhận ra implementer đã xong rồi chạy tiếp reviewer.
    expect(res.stepId).toBe('reviewer')
  })
})
