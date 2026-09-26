import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadJob,
  registerProvider,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

/*
 * Td2be3c3e TC02/TC03 — bất biến cốt lõi của `respawn`: một job mang
 * `metadata.respawn === true` KHÔNG bao giờ được đẩy `current_phase`, kể cả
 * khi `pipelineStepId` của nó trùng đúng `current_phase` hiện tại (biên tự
 * nhiên nêu ở design.md §4.4 — đây là lý do jobQueue.ts:872 cần cờ loại trừ
 * tường minh thay vì dựa vào "target thường nằm sau cursor").
 *
 * Chấm trực tiếp ở tầng `jobQueue.ts` (submitJob → advancePipelineStepChain),
 * tách khỏi `respawnStep` — hàm đó có một guard `assertStartAllowedSync`
 * riêng chặn mọi job không mang `metadata.orchestratorDispatch`/`isChatFeedback`
 * khi orchestrator đang bật cho task (xem "Bug phát hiện ở source" trong
 * test-result.md); test ở đây set `orchestratorDispatch: true` để cô lập
 * đúng một bất biến: gating của jobQueue.ts, không phải guard đó.
 */

const PROVIDER_ID = 'stub-respawn-gating'
const RUNNER_ID = 'stub-runner-respawn-gating'

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(_req: ExecuteRequest): Promise<ExecuteResult> {
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let home: string
let root: string
const savedEnv = { ...process.env }

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

function stateOf(taskId: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, '.dev-state', `${taskId}.json`), 'utf8'))
}

function submitRespawnJob(taskId: string, stepId: string) {
  return submitJob({
    runnerId: RUNNER_ID,
    agentRef: '',
    workspace: path.join(root, 'tasks', taskId),
    userPrompt: 'respawn brief',
    sessionMode: 'new',
    metadata: {
      projectRoot: path.dirname(root),
      devTeamRoot: root,
      taskId,
      pipelineStepId: stepId,
      respawn: true,
      // Cô lập bất biến của jobQueue.ts khỏi guard `assertStartAllowedSync`
      // riêng (xem "Bug phát hiện ở source").
      orchestratorDispatch: true,
    },
  })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-respawn-gating-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-respawn-gating-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-respawn-gating', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: RUNNER_ID, connectionId: 'stub-conn-respawn-gating', config: {} })
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    ['version: 1', 'steps:', "  - id: implementer", "    agent: ' '", '  - id: reviewer', "    agent: ' '"].join('\n'),
    'utf8',
  )
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {})

describe('respawn job (metadata.respawn) không đẩy current_phase (TC02)', () => {
  test('pipelineStepId TRÙNG current_phase hiện tại — job succeeded nhưng current_phase giữ nguyên (biên §4.4)', async () => {
    seedTask('G1', 'implementer')
    const job = submitRespawnJob('G1', 'implementer')
    const done = await settle(job.id)
    expect(done.status).toBe('succeeded')
    // Đối chứng: một job THƯỜNG (không respawn) cho đúng step này sẽ advance —
    // nếu respawn cũng advance thì assertion dưới sẽ fail đúng lúc bug tái diễn.
    await sleep(30)
    expect(stateOf('G1').current_phase).toBe('implementer')
  })

  test('pipelineStepId ở step KHÁC current_phase — vẫn không đẩy current_phase, state các step khác giữ nguyên (TC03)', async () => {
    seedTask('G2', 'reviewer')
    const job = submitRespawnJob('G2', 'implementer')
    const done = await settle(job.id)
    expect(done.status).toBe('succeeded')
    await sleep(30)
    expect(stateOf('G2').current_phase).toBe('reviewer')
  })

  test('đối chứng — job THƯỜNG (không mang metadata.respawn) cho step trùng current_phase THÌ advance (chứng minh test trên không xanh giả)', async () => {
    seedTask('G3', 'implementer')
    const job = submitJob({
      runnerId: RUNNER_ID,
      agentRef: '',
      workspace: path.join(root, 'tasks', 'G3'),
      userPrompt: 'do the thing',
      metadata: {
        projectRoot: path.dirname(root),
        devTeamRoot: root,
        taskId: 'G3',
        pipelineStepId: 'implementer',
        orchestratorDispatch: true,
      },
    })
    await settle(job.id)
    await sleep(30)
    expect(stateOf('G3').current_phase).not.toBe('implementer')
  })
})
