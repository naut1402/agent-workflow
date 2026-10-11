import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { on } from '../../../../src/backend/events/index.js'
import type { DashboardEvent } from '../../../../src/backend/events/index.js'
import { runAutomation } from '../../../../src/features/automations/business/runAction.js'
import { listRuns } from '../../../../src/features/automations/business/runLedger.js'
import type { AutomationRun, AutomationRuleRecord } from '../../../../src/features/automations/schemas/automation.js'
import {
  listJobs,
  registerProvider,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// Tfb77cf90-P3 (#442) — test characterization trước khi tách `runAction.ts`
// thành executor theo `kind`. Mỗi ca ghim một hành vi công khai mà
// `runAction.test.ts` chưa phủ: kết quả 409/403 của runTask existing, nhánh
// node điều phối của runTask create, httpRequest thành công (cắt stdout), danh
// sách field được thay biến `{{…}}` của từng kind, và `kind` lạ rơi về runTask.

const PROVIDER_ID = 'stub-executors-provider'
const RUNNER = 'stub-executors-runner'
const HANG_PROVIDER_ID = 'stub-executors-hang-provider'
const HANG_RUNNER = 'stub-executors-hang-runner'
const AGENT = 'stub-executors-agent'

let lastExecuteRequest: ExecuteRequest | null = null

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  family: 'console-command',
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 4 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    lastExecuteRequest = req
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

/** Job treo tới khi test gọi `releaseHang()` — dựng ca "task đang có job chạy". */
let releaseHang: () => void = () => {}
const hangProvider: RunnerProvider = {
  ...stubProvider,
  providerId: HANG_PROVIDER_ID,
  async execute(): Promise<ExecuteResult> {
    await new Promise<void>((resolve) => {
      releaseHang = resolve
    })
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let home: string
let root: string
const savedEnv = { ...process.env }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForOutcome(runId: string, projectId: string | null): Promise<AutomationRun> {
  for (let i = 0; i < 150; i++) {
    const run = listRuns(projectId, 50).find((r) => r.runId === runId)
    if (run && run.outcome !== 'running') return run
    await sleep(100)
  }
  throw new Error(`run ${runId} never settled`)
}

function baseRule(id: string, actions: unknown[]): AutomationRuleRecord {
  return {
    version: 1,
    id,
    name: 'Rule under test',
    enabled: true,
    triggers: [{ id: 'e1', kind: 'event', eventType: 'task.created' }],
    actions,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as AutomationRuleRecord
}

/** Chạy rule như event trigger — `{{trigger.payload.v}}` = `abc`. */
function runWithEvent(rule: AutomationRuleRecord, payload: Record<string, unknown> = {}): AutomationRun {
  return runAutomation({
    root,
    projectId: 'p1',
    rule,
    source: 'event',
    triggerId: 'e1',
    event: { type: 'task.created', payload: { v: 'abc', ...payload } },
  })
}

function writePipeline(dataRoot: string, orchestrator: boolean): void {
  fs.mkdirSync(path.join(dataRoot, 'custom-agents'), { recursive: true })
  fs.writeFileSync(
    path.join(dataRoot, 'custom-agents', `${AGENT}.md`),
    `---\nname: ${AGENT}\ndescription: agent stub cho test\n---\n\n## Vai trò\n\nStub.\n`,
  )
  fs.writeFileSync(
    path.join(dataRoot, 'pipeline.yaml'),
    [
      'version: 1',
      ...(orchestrator ? ['orchestrator: { enabled: true }'] : []),
      'steps:',
      '  - id: step-1',
      '    name: Step 1',
      `    agent: dashboard:${AGENT}`,
      `    runner_id: '${RUNNER}'`,
      '    hitl:',
      '      mode: none',
      '',
    ].join('\n'),
  )
}

function seedTaskState(taskId: string, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), 'yêu cầu\n')
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: 'step-1', ...extra }),
  )
}

const events: DashboardEvent[] = []
let unsubscribe: () => void = () => {}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-automations-exec-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  registerProvider(hangProvider)
  upsertConnection({ id: 'stub-executors-conn', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertConnection({ id: 'stub-executors-hang-conn', kind: 'local-console', providerId: HANG_PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: RUNNER, connectionId: 'stub-executors-conn', config: {} })
  upsertRunner({ id: HANG_RUNNER, connectionId: 'stub-executors-hang-conn', config: {} })
  unsubscribe = on('*', (e) => {
    events.push(e)
  })
})

afterAll(() => {
  unsubscribe()
  releaseHang()
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-automations-exec-root-'))
  lastExecuteRequest = null
  events.length = 0
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('runTask existing — kết quả không phải lỗi cấu hình', () => {
  test('409 (task đang có job chạy) → step skipped, outcome skipped, không có job mới', async () => {
    writePipeline(root, false)
    seedTaskState('Tbusy1')
    const busy = submitJob({
      runnerId: HANG_RUNNER,
      agentRef: '',
      workspace: path.join(root, 'tasks', 'Tbusy1'),
      userPrompt: '',
      metadata: { taskId: 'Tbusy1', devTeamRoot: root },
    })

    const run = runAutomation({
      root,
      projectId: 'p1',
      rule: baseRule('busy-409', [{ kind: 'runTask', mode: 'existing', taskId: 'Tbusy1' }]),
      source: 'manual',
    })
    const final = await waitForOutcome(run.runId, 'p1')
    releaseHang()

    expect(final.outcome).toBe('skipped')
    expect(final.error).toBe('task busy — step already running')
    expect(final.steps).toHaveLength(1)
    expect(final.steps![0]).toMatchObject({
      status: 'skipped',
      taskId: 'Tbusy1',
      error: 'task busy — step already running',
    })
    expect(final.steps![0].jobId).toBeUndefined()
    const jobsForTask = listJobs(200).filter((j) => j.metadata?.taskId === 'Tbusy1')
    expect(jobsForTask.map((j) => j.id)).toEqual([busy.id])
  })

  test('403 (task do node điều phối giữ) → skipped + emit orchestrator.start_requested', async () => {
    writePipeline(root, true)
    seedTaskState('Torch1', { orchestrator_enabled: true })

    const run = runAutomation({
      root,
      projectId: 'p1',
      rule: baseRule('orch-403', [{ kind: 'runTask', mode: 'existing', taskId: 'Torch1' }]),
      source: 'manual',
    })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('skipped')
    expect(final.steps![0]).toMatchObject({
      status: 'skipped',
      taskId: 'Torch1',
      error: 'task is orchestrated — start requested via orchestrator',
    })
    expect(final.steps![0].jobId).toBeUndefined()
    const requested = events.filter((e) => e.type === 'orchestrator.start_requested')
    expect(requested).toHaveLength(1)
    expect(requested[0].payload).toEqual({
      taskId: 'Torch1',
      projectId: 'p1',
      devTeamRoot: root,
      automationId: 'orch-403',
    })
  })
})

describe('runTask create — pipeline có node điều phối', () => {
  test('giao cho node điều phối: step có taskId, không có jobId, chạy đồng bộ ra succeeded', async () => {
    writePipeline(root, true)

    const run = runAutomation({
      root,
      projectId: 'p1',
      rule: baseRule('orch-create', [{ kind: 'runTask', mode: 'create', prompt: 'việc mới', runnerId: RUNNER }]),
      source: 'manual',
    })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('succeeded')
    const step = final.steps![0]
    expect(step.status).toBe('succeeded')
    expect(step.taskId).toMatch(/^auto-[0-9a-f]{8}$/)
    expect(step.jobId).toBeUndefined()
    expect(step.stdout).toBe('')
    expect(fs.existsSync(path.join(root, 'tasks', step.taskId!))).toBe(true)
    // Automation KHÔNG tự submit job cho step đầu — mọi job của task (nếu có) là
    // do node điều phối dispatch (`orchestratorDispatch`), không mang automationId.
    const jobs = listJobs(200).filter((j) => j.metadata?.taskId === step.taskId)
    expect(jobs.every((j) => j.metadata?.automationId === undefined)).toBe(true)
    // Hành vi lạ có sẵn (giữ nguyên): automation tạo task không phát `task.created`.
    expect(events.some((e) => e.type === 'task.created')).toBe(false)
  })
})

describe('httpRequest — thành công', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('kết quả đồng bộ: stdout = body cắt ở 64 000 ký tự, không có job, method/headers/body chuyển nguyên', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response('x'.repeat(70_000), { status: 200 })
    }) as typeof fetch

    const run = runAutomation({
      root,
      projectId: 'p1',
      rule: baseRule('http-ok', [
        { kind: 'httpRequest', method: 'POST', url: 'https://example.com/hook', headers: { 'X-A': '1' }, body: '{"a":1}' },
      ]),
      source: 'manual',
    })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('succeeded')
    const step = final.steps![0]
    expect(step.status).toBe('succeeded')
    expect(step.jobId).toBeUndefined()
    expect(step.taskId).toBeUndefined()
    expect(step.stdout).toBe(`${'x'.repeat(64_000)}\n…[truncated]`)
    expect(step.input).toEqual({
      method: 'POST',
      url: 'https://example.com/hook',
      headers: { 'X-A': '1' },
      body: '{"a":1}',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://example.com/hook')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toEqual({ 'X-A': '1' })
    expect(calls[0].init?.body).toBe('{"a":1}')
  })

  test('fetch trả lỗi HTTP → step failed với thông điệp của fetchUrlSafe', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    const run = runAutomation({
      root,
      projectId: 'p1',
      rule: baseRule('http-500', [{ kind: 'httpRequest', method: 'GET', url: 'https://example.com/x' }]),
      source: 'manual',
    })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('failed')
    expect(final.steps![0]).toMatchObject({ status: 'failed', error: 'fetch failed: 500' })
  })
})

describe('thay biến {{…}} theo từng kind', () => {
  test('httpRequest: thay name/url/body, KHÔNG thay headers', async () => {
    const run = runWithEvent(
      baseRule('subst-http', [
        {
          kind: 'httpRequest',
          name: 'gọi {{trigger.payload.v}}',
          method: 'GET',
          url: 'http://example.com/{{trigger.payload.v}}',
          headers: { 'X-H': '{{trigger.payload.v}}' },
          body: 'b-{{trigger.payload.v}}',
        },
      ]),
    )
    const final = await waitForOutcome(run.runId, 'p1')

    const step = final.steps![0]
    expect(step.name).toBe('gọi abc')
    expect(step.input).toEqual({
      method: 'GET',
      url: 'http://example.com/abc',
      headers: { 'X-H': '{{trigger.payload.v}}' },
      body: 'b-abc',
    })
    // URL http bị chặn ở fetchUrlSafe — chứng minh url đã thay rồi mới gọi.
    expect(step.error).toMatch(/https/i)
  })

  test('runCommand: thay name/runnerId/params', async () => {
    const run = runWithEvent(
      baseRule('subst-cmd', [
        {
          kind: 'runCommand',
          name: 'lệnh {{trigger.payload.v}}',
          runnerId: '{{trigger.payload.r}}',
          params: 'echo {{trigger.payload.v}}',
        },
      ]),
      { r: RUNNER },
    )
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('succeeded')
    expect(final.steps![0].name).toBe('lệnh abc')
    expect(final.steps![0].input).toEqual({ runnerId: RUNNER, params: 'echo abc' })
    expect(lastExecuteRequest!.userPrompt).toBe('echo abc')
  })

  test('runTask existing: thay taskId/runnerId', async () => {
    const run = runWithEvent(
      baseRule('subst-task', [
        { kind: 'runTask', mode: 'existing', taskId: 'T{{trigger.payload.v}}', runnerId: 'r-{{trigger.payload.v}}' },
      ]),
    )
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.steps![0].input).toEqual({ mode: 'existing', taskId: 'Tabc', runnerId: 'r-abc' })
    expect(final.steps![0].error).toBe('task not found')
  })

  test('runTask create: thay prompt/profileName', async () => {
    const run = runWithEvent(
      baseRule('subst-create', [
        { kind: 'runTask', mode: 'create', prompt: 'làm {{trigger.payload.v}}', profileName: 'p-{{trigger.payload.v}}' },
      ]),
    )
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.steps![0].input).toEqual({ mode: 'create', prompt: 'làm abc', profileName: 'p-abc' })
  })

  test('runTask: KHÔNG thay projectId — id literal ra lỗi project đích', async () => {
    const run = runWithEvent(
      baseRule('subst-project', [
        { kind: 'runTask', mode: 'existing', taskId: 'Tx1', projectId: '{{trigger.payload.v}}' },
      ]),
    )
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.steps![0].input).toEqual({ mode: 'existing', taskId: 'Tx1', projectId: '{{trigger.payload.v}}' })
    expect(final.steps![0].error).toBe('unknown target project: {{trigger.payload.v}}')
  })
})

// Hành vi lạ có sẵn (giữ nguyên khi đổi sang Registry): `kind` không nằm trong
// schema — chỉ lọt vào được khi rule không đi qua Zod — rơi vào nhánh runTask
// ở cả 3 chỗ (thay biến, tóm tắt input, chọn executor).
describe('kind lạ rơi về runTask', () => {
  test('không có mode → coi như existing, báo action misconfigured', async () => {
    const run = runAutomation({
      root,
      projectId: 'p1',
      rule: baseRule('bogus-kind', [{ kind: 'bogus' }]),
      source: 'manual',
    })
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('failed')
    expect(final.steps![0]).toMatchObject({
      status: 'failed',
      error: 'action misconfigured: taskId required for mode=existing',
    })
    expect(final.steps![0].input).toEqual({ mode: 'existing', taskId: undefined })
  })

  test('mode=existing → chạy đường runTask existing, thay biến theo field của runTask', async () => {
    const run = runWithEvent(
      baseRule('bogus-kind-existing', [{ kind: 'bogus', mode: 'existing', taskId: 'T{{trigger.payload.v}}' }]),
    )
    const final = await waitForOutcome(run.runId, 'p1')

    expect(final.outcome).toBe('failed')
    expect(final.steps![0].input).toEqual({ mode: 'existing', taskId: 'Tabc' })
    expect(final.steps![0].taskId).toBe('Tabc')
    expect(final.steps![0].error).toBe('task not found')
  })
})
