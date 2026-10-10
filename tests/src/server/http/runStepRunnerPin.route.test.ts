import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import {
  listJobs,
  loadJob,
  registerProvider,
  setDefaultRunner,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// Tbfb52394 · nhóm B của test-spec — `steps[].runner_id` ở đường CHẠY step
// (`POST /api/tasks/:id/run-step`) và ở chain tự động sau khi step xong.
//
// Suite riêng chứ không nối vào `runStep.route.test.ts`: suite đó dùng CHUNG một
// `pipeline.yaml` cho cả 20+ case, nên thêm pin vào đó là đổi input của những
// case hiện có — đúng cái mà TC-B11 ("suite cũ xanh nguyên trạng") cấm. Ở đây
// mỗi task có `tasks/<id>/pipeline.yaml` riêng nên pin của case này không chạm
// case kia.
//
// Ba runner đều chạy-AI-được để `getDefaultRunner()` có cái để trả; runner mặc
// định được chốt tường minh bằng `setDefaultRunner` thay vì dựa vào thứ tự chèn.

const PROVIDER_ID = 'stub-runner-pin-api'
const CONSOLE_PROVIDER_ID = 'stub-runner-pin-console'

const DEFAULT_RUNNER = 'default-ai'
const PINNED_RUNNER = 'pinned-ai'
const CALLER_RUNNER = 'caller-ai'
const DISABLED_RUNNER = 'tat-roi-ai'
const CONSOLE_RUNNER = 'chay-lenh'

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(): Promise<ExecuteResult> {
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

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

async function waitForPhase(taskId: string, predicate: (phase: string | null) => boolean) {
  const stateFile = path.join(root, '.dev-state', `${taskId}.json`)
  for (let i = 0; i < 400; i++) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (predicate(state.current_phase ?? null)) return state
    await sleep(5)
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  throw new Error(`current_phase never matched (last=${state.current_phase})`)
}

/** Job của một step trong task, chờ tới khi chain sinh ra nó. */
async function jobOfStep(taskId: string, stepId: string) {
  for (let i = 0; i < 400; i++) {
    const hit = listJobs(500).find(
      (j) => j.metadata?.taskId === taskId && j.metadata?.pipelineStepId === stepId,
    )
    if (hit) return hit
    await sleep(5)
  }
  throw new Error(`không có job nào cho step ${stepId} của ${taskId}`)
}

type StepSpec = { id: string; runner_id?: string; gate?: string }

/** Task với pipeline riêng — `steps_replace` để pin của case này không rò sang case khác. */
function seedTask(taskId: string, steps: StepSpec[], currentPhase = steps[0].id) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: currentPhase }, null, 2),
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
        ...(s.gate ? [`    hitl: { mode: manual, gate_id: ${s.gate} }`] : []),
      ]),
      '',
    ].join('\n'),
    'utf8',
  )
}

function runStep(taskId: string, body: Record<string, unknown> = {}) {
  return app.request(`/api/tasks/${taskId}/run-step`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function seedRunner(id: string, opts: { enabled?: boolean; console?: boolean } = {}) {
  upsertConnection({
    id: `conn-${id}`,
    kind: 'local-console',
    providerId: opts.console ? CONSOLE_PROVIDER_ID : PROVIDER_ID,
    cliPath: 'stub',
  })
  upsertRunner({ id, connectionId: `conn-${id}`, enabled: opts.enabled !== false, config: {} })
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-run-step-pin-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  registerProvider(stubProvider)
  registerProvider({ ...stubProvider, providerId: CONSOLE_PROVIDER_ID })
  seedRunner(DEFAULT_RUNNER)
  seedRunner(PINNED_RUNNER)
  seedRunner(CALLER_RUNNER)
  seedRunner(DISABLED_RUNNER, { enabled: false })
  seedRunner(CONSOLE_RUNNER, { console: true })
  setDefaultRunner(DEFAULT_RUNNER)
  // Pipeline global: mọi task ở đây đều ghi đè bằng pipeline riêng.
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    ['version: 1', 'steps:', '  - id: implementer', "    agent: ' '", ''].join('\n'),
    'utf8',
  )
  app = await createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})

describe('run-step — step đã pin chạy đúng runner đó', () => {
  test('TC-B01: step pin, body không kèm runnerId ⇒ job dùng runner đã pin và chạy xong', async () => {
    seedTask('B01', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    const res = await runStep('B01')
    expect(res.status).toBe(201)

    const { job } = await res.json()
    expect(job.runnerId).toBe(PINNED_RUNNER)
    expect((await settle(job.id)).status).toBe('succeeded')
  })

  test('TC-B02: body kèm runnerId ⇒ CALLER THẮNG pin', async () => {
    seedTask('B02', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    const { job } = await (await runStep('B02', { runnerId: CALLER_RUNNER })).json()
    // Hợp đồng để automation / nút run giữ được quyền ép runner.
    expect(job.runnerId).toBe(CALLER_RUNNER)
    expect((await settle(job.id)).status).toBe('succeeded')
  })

  test('TC-B03: step không pin, body không kèm runnerId ⇒ runner mặc định (AC-6)', async () => {
    seedTask('B03', [{ id: 'implementer' }])
    const { job } = await (await runStep('B03')).json()
    expect(job.runnerId).toBe(DEFAULT_RUNNER)
    expect((await settle(job.id)).status).toBe('succeeded')
  })
})

describe('run-step — pin hỏng KHÔNG được làm đứng pipeline', () => {
  test('TC-B04: pin trỏ runner đã xoá ⇒ chạy bằng runner mặc định, không job nào failed', async () => {
    seedTask('B04', [{ id: 'implementer', runner_id: 'khong-ton-tai' }])
    const { job } = await (await runStep('B04')).json()
    expect(job.runnerId).toBe(DEFAULT_RUNNER)
    expect((await settle(job.id)).status).toBe('succeeded')
    expect(listJobs(500).filter((j) => j.metadata?.taskId === 'B04' && j.status === 'failed')).toEqual([])
  })

  test('TC-B05: pin trỏ runner enabled:false ⇒ dùng mặc định và chạy xong (trước đây job FAIL)', async () => {
    seedTask('B05', [{ id: 'implementer', runner_id: DISABLED_RUNNER }])
    const { job } = await (await runStep('B05')).json()
    // Đổi hành vi có chủ ý: dọn danh sách runner không được làm đứng pipeline.
    expect(job.runnerId).toBe(DEFAULT_RUNNER)
    expect((await settle(job.id)).status).toBe('succeeded')
  })

  test('TC-B06: pin trỏ runner console-command ⇒ dùng mặc định và chạy xong', async () => {
    seedTask('B06', [{ id: 'implementer', runner_id: CONSOLE_RUNNER }])
    const { job } = await (await runStep('B06')).json()
    expect(job.runnerId).toBe(DEFAULT_RUNNER)
    expect((await settle(job.id)).status).toBe('succeeded')
  })

  test('pin là chuỗi rác bị sanitise gọt ⇒ KHÔNG khớp nhầm runner khác', async () => {
    // `default.ai` gọt thành `defaultai`; `pinned-ai` không có biến thể nào
    // trùng — điểm cần chốt là nó không âm thầm trở thành một runner có thật.
    seedTask('B06b', [{ id: 'implementer', runner_id: 'pinned.ai' }])
    const { job } = await (await runStep('B06b')).json()
    expect(job.runnerId).toBe(DEFAULT_RUNNER)
  })
})

describe('run-step — pin KHÔNG lây sang step khác trong chain (AC-5)', () => {
  test('TC-B07: step 1 pin, step 2 & 3 không pin ⇒ chỉ step 1 dùng pin', async () => {
    seedTask('B07', [
      { id: 'implementer', runner_id: PINNED_RUNNER },
      { id: 'reviewer' },
      { id: 'pr-creator' },
    ])
    const { job } = await (await runStep('B07')).json()
    expect(job.runnerId).toBe(PINNED_RUNNER)

    // Case bắt regression chính của task: thiếu nó thì pin lây sang mọi step sau.
    expect((await jobOfStep('B07', 'reviewer')).runnerId).toBe(DEFAULT_RUNNER)
    expect((await jobOfStep('B07', 'pr-creator')).runnerId).toBe(DEFAULT_RUNNER)
  })

  test('TC-B08: step 1 không pin, step 2 pin ⇒ chain sang step 2 dùng đúng pin của nó', async () => {
    seedTask('B08', [{ id: 'implementer' }, { id: 'reviewer', runner_id: PINNED_RUNNER }])
    const { job } = await (await runStep('B08')).json()
    expect(job.runnerId).toBe(DEFAULT_RUNNER)

    expect((await jobOfStep('B08', 'reviewer')).runnerId).toBe(PINNED_RUNNER)
  })

  test('TC-B09: caller ép runner ⇒ CHỈ step được bấm đi theo, step sau về mặc định', async () => {
    seedTask('B09', [{ id: 'implementer' }, { id: 'reviewer' }])
    const { job } = await (await runStep('B09', { runnerId: CALLER_RUNNER })).json()
    expect(job.runnerId).toBe(CALLER_RUNNER)

    // Đổi hành vi có chủ ý (design §4.2 L3): trước đây caller ép runner thì cả
    // chain đi theo. Mỗi step giờ tự giải runner của chính nó.
    expect((await jobOfStep('B09', 'reviewer')).runnerId).toBe(DEFAULT_RUNNER)
  })

  test('hai step pin hai runner khác nhau ⇒ mỗi job đúng pin của step mình', async () => {
    seedTask('B09b', [
      { id: 'implementer', runner_id: PINNED_RUNNER },
      { id: 'reviewer', runner_id: CALLER_RUNNER },
    ])
    await runStep('B09b')
    expect((await jobOfStep('B09b', 'implementer')).runnerId).toBe(PINNED_RUNNER)
    expect((await jobOfStep('B09b', 'reviewer')).runnerId).toBe(CALLER_RUNNER)
  })
})

describe('run-step — jump/skip lấy pin của step THỰC SỰ chạy', () => {
  test('TC-B10: skipIntermediate tới một step khác ⇒ dùng pin của step đích', async () => {
    seedTask('B10', [
      { id: 'implementer', runner_id: PINNED_RUNNER },
      { id: 'reviewer', runner_id: CALLER_RUNNER, gate: 'hitl-b10' },
      { id: 'pr-creator' },
    ])
    const res = await runStep('B10', { targetStepId: 'reviewer', skipIntermediate: true })
    expect(res.status).toBe(201)

    const { job } = await res.json()
    // Pin của `current_phase` (implementer) không được thắng pin của step đích.
    expect(job.metadata.pipelineStepId).toBe('reviewer')
    expect(job.runnerId).toBe(CALLER_RUNNER)
  })

  test('TC-B10b: chain có targetStepId ⇒ step trung gian vẫn dùng pin của chính nó', async () => {
    seedTask('B10b', [
      { id: 'implementer' },
      { id: 'reviewer', runner_id: PINNED_RUNNER },
      { id: 'pr-creator' },
    ])
    await runStep('B10b', { targetStepId: 'reviewer' })
    expect((await jobOfStep('B10b', 'reviewer')).runnerId).toBe(PINNED_RUNNER)
  })
})

describe('TC-B11: pipeline không step nào pin ⇒ hành vi nguyên trạng (AC-6)', () => {
  test('chain 3 step gate-less chạy hết và mọi job dùng runner mặc định', async () => {
    seedTask('B11', [{ id: 'implementer' }, { id: 'reviewer' }, { id: 'pr-creator' }])
    const { job } = await (await runStep('B11')).json()
    await jobOfStep('B11', 'pr-creator')

    const jobs = listJobs(500).filter((j) => j.metadata?.taskId === 'B11')
    expect(jobs.length).toBeGreaterThanOrEqual(3)
    expect(jobs.every((j) => j.runnerId === DEFAULT_RUNNER)).toBe(true)
    expect((await settle(job.id)).status).toBe('succeeded')
  })

  test('chain dừng ở gate như cũ — pin không đổi luật gate', async () => {
    seedTask('B11b', [{ id: 'implementer' }, { id: 'reviewer', gate: 'hitl-b11' }, { id: 'pr-creator' }])
    await runStep('B11b')
    await waitForPhase('B11b', (p) => p === 'reviewer')
    await sleep(60)
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'B11b.json'), 'utf8'))
    expect(state.current_phase).toBe('reviewer')
    expect(listJobs(500).some((j) => j.metadata?.taskId === 'B11b' && j.metadata?.pipelineStepId === 'pr-creator')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tbfb52394 · TC-C09 của test-spec — `POST /api/jobs` mang `metadata.pipelineStepId`.
//
// Dashboard FE không dùng đường này, nhưng agent orchestrator ngoài / MCP thì có,
// và nó đi qua cùng cửa quyền `assertStartAllowed` như run-step. Để trống nghĩa
// là cùng một pipeline chạy ra hai model khác nhau tuỳ ai bấm nút.
// ---------------------------------------------------------------------------

describe('TC-C09: POST /api/jobs với metadata.pipelineStepId', () => {
  function postJob(taskId: string, stepId: string, extra: Record<string, unknown> = {}) {
    return app.request('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        agentRef: '',
        workspace: path.join(root, 'tasks', taskId),
        userPrompt: 'do the thing',
        metadata: { taskId, pipelineStepId: stepId },
        ...extra,
      }),
    })
  }

  test('step đã pin, body không kèm runnerId ⇒ job dùng runner đã pin', async () => {
    seedTask('C09a', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    const res = await postJob('C09a', 'implementer')
    expect(res.status).toBe(201)
    expect((await res.json()).job.runnerId).toBe(PINNED_RUNNER)
  })

  test('caller truyền runnerId ⇒ caller thắng pin (cùng mẫu với run-step)', async () => {
    seedTask('C09b', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    const res = await postJob('C09b', 'implementer', { runnerId: CALLER_RUNNER })
    expect((await res.json()).job.runnerId).toBe(CALLER_RUNNER)
  })

  test('step không pin ⇒ runner mặc định (AC-6)', async () => {
    seedTask('C09c', [{ id: 'implementer' }])
    const res = await postJob('C09c', 'implementer')
    expect((await res.json()).job.runnerId).toBe(DEFAULT_RUNNER)
  })

  test('pin hỏng ⇒ runner mặc định, không 4xx — pin hỏng không chặn đường API', async () => {
    seedTask('C09d', [{ id: 'implementer', runner_id: 'khong-ton-tai' }])
    const res = await postJob('C09d', 'implementer')
    expect(res.status).toBe(201)
    expect((await res.json()).job.runnerId).toBe(DEFAULT_RUNNER)
  })

  test('job KHÔNG mang pipelineStepId ⇒ không đọc pin, dùng runner mặc định', async () => {
    seedTask('C09e', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    const res = await app.request('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        agentRef: '',
        workspace: path.join(root, 'tasks', 'C09e'),
        userPrompt: 'ad-hoc',
        metadata: { taskId: 'C09e' },
      }),
    })
    expect((await res.json()).job.runnerId).toBe(DEFAULT_RUNNER)
  })

  test('pipelineStepId trỏ step không tồn tại ⇒ runner mặc định, không throw', async () => {
    seedTask('C09f', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    const res = await postJob('C09f', 'khong-co-step-nay')
    expect(res.status).toBe(201)
    expect((await res.json()).job.runnerId).toBe(DEFAULT_RUNNER)
  })
})

// ---------------------------------------------------------------------------
// Tbfb52394 · TC-C01…C04 của test-spec — hai đường start job còn lại đi qua route.
// ---------------------------------------------------------------------------

async function taskRow(taskId: string) {
  const rows = (await (await app.request('/api/tasks')).json()).tasks as any[]
  const row = rows.find((t) => t.task_id === taskId)
  if (!row) throw new Error(`không thấy task ${taskId} trong GET /api/tasks`)
  return row
}

describe('TC-C01: pin không rò rỉ qua gate', () => {
  test('chain dừng ở gate, approve xong ⇒ step sau dùng runner mặc định', async () => {
    seedTask('C01', [
      { id: 'implementer', runner_id: PINNED_RUNNER },
      { id: 'reviewer', gate: 'hitl-c01' },
      { id: 'pr-creator' },
    ])
    const { job } = await (await runStep('C01')).json()
    expect(job.runnerId).toBe(PINNED_RUNNER)
    await waitForPhase('C01', (p) => p === 'reviewer')

    const row = await taskRow('C01')
    const res = await app.request('/api/task-state?id=C01', {
      method: 'PUT',
      body: JSON.stringify({ action: 'approve', gate_id: 'hitl-c01', mtime: row.state_mtime }),
    })
    expect(res.status).toBe(200)

    await runStep('C01')
    // Pin của step trước không được sống sót qua gate.
    expect((await jobOfStep('C01', 'reviewer')).runnerId).toBe(DEFAULT_RUNNER)
  })
})

describe('TC-C02…C04: POST /api/tasks với run: true', () => {
  function createTask(taskId: string, steps: StepSpec[], body: Record<string, unknown> = {}) {
    return app.request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        taskId,
        prompt: 'do the thing',
        run: true,
        pipeline: {
          steps: steps.map((s) => ({
            id: s.id,
            agent: ' ',
            ...(s.runner_id !== undefined ? { runner_id: s.runner_id } : {}),
          })),
        },
        ...body,
      }),
    })
  }

  test('TC-C02: step đầu đã pin, body không kèm runnerId ⇒ job dùng pin', async () => {
    const res = await createTask('C02', [{ id: 'implementer', runner_id: PINNED_RUNNER }])
    expect(res.status).toBe(201)
    expect((await res.json()).job.runnerId).toBe(PINNED_RUNNER)
  })

  test('TC-C03: body kèm runnerId ⇒ caller thắng pin', async () => {
    const res = await createTask('C03', [{ id: 'implementer', runner_id: PINNED_RUNNER }], {
      runnerId: CALLER_RUNNER,
    })
    expect((await res.json()).job.runnerId).toBe(CALLER_RUNNER)
  })

  test('TC-C04: step đầu không pin ⇒ runner mặc định (AC-6)', async () => {
    const res = await createTask('C04', [{ id: 'implementer' }])
    expect((await res.json()).job.runnerId).toBe(DEFAULT_RUNNER)
  })

  test('pin chỉ ở step SAU ⇒ job đầu vẫn dùng mặc định, không lấy nhầm pin của step khác', async () => {
    const res = await createTask('C04b', [
      { id: 'implementer' },
      { id: 'reviewer', runner_id: PINNED_RUNNER },
    ])
    expect((await res.json()).job.runnerId).toBe(DEFAULT_RUNNER)
  })
})
