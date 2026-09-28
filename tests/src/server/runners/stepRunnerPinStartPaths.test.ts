import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  listJobs,
  loadJob,
  registerProvider,
  sendTaskFeedback,
  setDefaultRunner,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import { respawnStep } from '../../../../src/features/orchestrator/business/decisionLoop.js'
import type { ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// Tbfb52394 · TC-C05 / TC-C06 / TC-C10 của test-spec — hai đường start job không
// đi qua HTTP route.
//
// - **Respawn của node điều phối** (`respawnStep`) phải áp pin. Nó không có khái
//   niệm "caller chỉ định runner" nên không có biến thể caller-thắng.
// - **Chat feedback** (`sendTaskFeedback`) CỐ Ý không áp pin: nó tiếp nối session
//   của chính job cha, mà session id gắn với provider — đổi runner giữa chừng là
//   hỏng resume. TC-C10 chốt bất biến đó để nó là quyết định, không phải bỏ sót.

const PROVIDER_ID = 'stub-pin-start-paths-api'
const DEFAULT_RUNNER = 'default-start-paths'
const PINNED_RUNNER = 'pinned-start-paths'

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

function jobsOf(taskId: string, stepId: string) {
  return listJobs(500).filter(
    (j) => j.metadata?.taskId === taskId && j.metadata?.pipelineStepId === stepId,
  )
}

async function waitForJobCount(taskId: string, stepId: string, n: number) {
  for (let i = 0; i < 400; i++) {
    const hits = jobsOf(taskId, stepId)
    if (hits.length >= n) return hits
    await sleep(5)
  }
  throw new Error(`step ${stepId} của ${taskId} chỉ có ${jobsOf(taskId, stepId).length}/${n} job`)
}

type StepSpec = { id: string; runner_id?: string }

function seedTask(taskId: string, steps: StepSpec[]) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: steps[0].id }, null, 2),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), 'do the thing', 'utf8')
  fs.writeFileSync(
    path.join(root, 'tasks', taskId, 'pipeline.yaml'),
    [
      'version: 1',
      'steps_replace: true',
      'steps:',
      ...steps.flatMap((s) => [
        `  - id: ${s.id}`,
        "    agent: ' '",
        ...(s.runner_id !== undefined ? [`    runner_id: '${s.runner_id}'`] : []),
      ]),
      '',
    ].join('\n'),
    'utf8',
  )
}

/** Job "đã chạy xong" của một step — điều kiện tiên quyết của `respawnStep`. */
async function finishedJobFor(taskId: string, stepId: string, runnerId: string) {
  const job = submitJob({
    runnerId,
    agentRef: '',
    workspace: path.join(root, 'tasks', taskId),
    userPrompt: 'do the thing',
    sessionMode: 'new',
    metadata: {
      projectRoot: path.dirname(root),
      devTeamRoot: root,
      taskId,
      pipelineStepId: stepId,
      // Không đẩy `current_phase` — case này chỉ cần một job đã kết thúc.
      respawn: true,
      orchestratorDispatch: true,
    },
  })
  await settle(job.id)
  return job
}

function seedRunner(id: string) {
  upsertConnection({ id: `conn-${id}`, kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id, connectionId: `conn-${id}`, config: {} })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-pin-start-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-pin-start-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  seedRunner(DEFAULT_RUNNER)
  seedRunner(PINNED_RUNNER)
  setDefaultRunner(DEFAULT_RUNNER)
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    ['version: 1', 'steps:', '  - id: implementer', "    agent: ' '", ''].join('\n'),
    'utf8',
  )
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

describe('respawnStep — node điều phối chạy lại một step', () => {
  test('TC-C05: respawn một step đã pin ⇒ job mới mang runner đã pin', async () => {
    seedTask('C05', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    // Job đầu cố ý dùng runner MẶC ĐỊNH: nếu respawn kế thừa job cũ thay vì đọc
    // pin thì assert dưới sẽ bắt được.
    await finishedJobFor('C05', 'implementer', DEFAULT_RUNNER)

    await respawnStep({ root, taskId: 'C05', projectId: '' }, 'implementer')

    const jobs = await waitForJobCount('C05', 'implementer', 2)
    expect(jobs[0].runnerId).toBe(PINNED_RUNNER)
  })

  test('TC-C06: respawn một step KHÔNG pin ⇒ runner mặc định', async () => {
    seedTask('C06', [{ id: 'implementer' }])
    await finishedJobFor('C06', 'implementer', PINNED_RUNNER)

    await respawnStep({ root, taskId: 'C06', projectId: '' }, 'implementer')

    const jobs = await waitForJobCount('C06', 'implementer', 2)
    // Không kế thừa runner của job cũ — mỗi lượt tự giải lại.
    expect(jobs[0].runnerId).toBe(DEFAULT_RUNNER)
  })

  test('TC-C06b: pin hỏng ⇒ respawn vẫn chạy được bằng runner mặc định', async () => {
    seedTask('C06b', [{ id: 'implementer', runner_id: 'khong-ton-tai' }])
    await finishedJobFor('C06b', 'implementer', DEFAULT_RUNNER)

    await respawnStep({ root, taskId: 'C06b', projectId: '' }, 'implementer')

    const jobs = await waitForJobCount('C06b', 'implementer', 2)
    expect(jobs[0].runnerId).toBe(DEFAULT_RUNNER)
  })
})

describe('TC-C10: chat feedback CỐ Ý kế thừa runner của job cha', () => {
  test('job của step đã pin chạy xong ⇒ job feedback dùng CÙNG runner với job cha', async () => {
    seedTask('C10', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    const parent = await finishedJobFor('C10', 'implementer', PINNED_RUNNER)

    const fed = await sendTaskFeedback('C10', '', 'thêm một ý nữa')
    expect('job' in fed).toBe(true)
    const child = (fed as any).job
    // Tiếp nối session của chính job đó — đổi runner giữa chừng là hỏng resume.
    expect(child.runnerId).toBe(loadJob(parent.id)!.runnerId)
    expect(child.runnerId).toBe(PINNED_RUNNER)
  })

  test('job cha chạy runner KHÁC pin ⇒ feedback vẫn theo job cha, KHÔNG nhảy sang pin', async () => {
    // Ghi nhận hành vi hiện tại (design §6): `sendTaskFeedback` re-resolve
    // `agentRef` theo pipeline đang sống nhưng KHÔNG re-resolve runner. Sửa
    // điều đó nằm ngoài phạm vi đã duyệt của task này.
    seedTask('C10b', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    await finishedJobFor('C10b', 'implementer', DEFAULT_RUNNER)

    const fed = await sendTaskFeedback('C10b', '', 'thêm một ý nữa')
    expect((fed as any).job.runnerId).toBe(DEFAULT_RUNNER)
  })
})
