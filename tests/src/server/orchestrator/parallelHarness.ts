import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _resetEventBusForTest, on, type DashboardEvent } from '../../../../src/backend/events/index.js'
import { _resetOrchestratorForTest, handleEvent } from '../../../../src/features/orchestrator/business/decisionLoop.js'
import {
  listJobs,
  loadJob,
  registerProvider,
  setDefaultRunner,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { JobRecord } from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'
import { DECISION_SENTINEL } from '../../../../src/features/orchestrator/schemas/orchestrator.js'

/*
 * Ted0cf9ac — khung dựng cảnh "job điều phối và job step chạy chồng nhau".
 *
 * Agent CLI là phụ thuộc ngoài (testing.md §5) nên được giả lập, nhưng MỌI thứ
 * còn lại là thật: hàng đợi `jobQueue` (làn theo task), `runJob` (advance cursor,
 * phát `job.finished`/`job.failed`), và `handleEvent` được nối vào bus y như
 * `startOrchestratorLoop` — chỉ không bật sweep timer, để test tự gọi sweep.
 *
 * Mỗi job giả lập GIỮ ở `running` cho tới khi test gọi `finish(jobId, …)`:
 * đó là cách dựng tất định "S1 đang chạy trong lúc O1 chạy" (test-spec §1).
 */

export const PROJECT = 'P-par'

export interface Harness {
  home: string
  root: string
  /** Job id đã vào `provider.execute` (đã `running`), theo thứ tự bắt đầu. */
  started: string[]
  /** Cho job đang giữ kết thúc. `ok:false` ⇒ `job.failed`. */
  finish(jobId: string, res?: { ok?: boolean; stdout?: string }): void
  /** Thả mọi job đang giữ (dọn cuối test). */
  releaseAll(): void
  /** Đặt stdout mặc định cho lượt điều phối khi được `finish` không kèm stdout. */
  orchestratorStdout: string
}

const holders = new Map<string, (r: ExecuteResult) => void>()
let current: Harness | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function waitFor<T>(fn: () => T | null | undefined | false, label: string, tries = 600): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = fn()
    if (v) return v
    await sleep(5)
  }
  throw new Error(`timeout: ${label}`)
}

/** Nhường event loop đủ lâu để microtask/pump/handler async chạy hết. */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await sleep(2)
}

export function makeProvider(providerId: string): RunnerProvider {
  return {
    providerId,
    validateRunnerConfig: () => ({ ok: true, errors: [] }),
    validateCredential: () => ({ ok: true, errors: [] }),
    capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
    async execute(req: ExecuteRequest): Promise<ExecuteResult> {
      current?.started.push(req.jobId)
      return new Promise<ExecuteResult>((resolve) => {
        holders.set(req.jobId, resolve)
        // `cancelJob` abort signal — CLI thật chết vì SIGTERM, giải phóng làn của job.
        req.signal?.addEventListener('abort', () => {
          holders.delete(req.jobId)
          resolve({ ok: false, exitCode: null, durationMs: 1, error: 'aborted' })
        })
      })
    },
  }
}

/** Dựng home/root + runner giả làm runner mặc định. Gọi trong `beforeAll`. */
export function setupHarness(tag: string): Harness {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `dtd-par-${tag}-home-`))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dtd-par-${tag}-root-`))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  // Hậu tố `-api` ⇒ họ `ai-api` ⇒ đủ điều kiện làm runner mặc định (lượt điều phối không pin runner).
  const providerId = `stub-par-${tag}-api`
  registerProvider(makeProvider(providerId))
  upsertConnection({ id: `conn-par-${tag}`, kind: 'local-console', providerId, cliPath: 'stub' } as any)
  upsertRunner({ id: `runner-par-${tag}`, connectionId: `conn-par-${tag}`, config: {} } as any)
  setDefaultRunner(`runner-par-${tag}`)
  const h: Harness = {
    home,
    root,
    started: [],
    orchestratorStdout: `${DECISION_SENTINEL} {"action":"summary","summary":"ok","reason":"test"}`,
    finish(jobId, res = {}) {
      const resolve = holders.get(jobId)
      if (!resolve) throw new Error(`job ${jobId} không ở trạng thái đang giữ`)
      holders.delete(jobId)
      const job = loadJob(jobId)
      const stdout =
        res.stdout ?? (job?.metadata?.orchestratorJob === true ? h.orchestratorStdout : 'STEP_SUMMARY: xong')
      const ok = res.ok ?? true
      resolve({ ok, exitCode: ok ? 0 : 1, durationMs: 1, stdout, ...(ok ? {} : { error: 'boom' }) })
    },
    releaseAll() {
      for (const [id, resolve] of [...holders]) {
        holders.delete(id)
        resolve({ ok: true, exitCode: 0, durationMs: 1, stdout: '' })
      }
    },
  }
  current = h
  return h
}

export function teardownHarness(h: Harness): void {
  h.releaseAll()
  fs.rmSync(h.home, { recursive: true, force: true })
  fs.rmSync(h.root, { recursive: true, force: true })
}

/**
 * Reset giữa các test: bus + state in-memory của vòng điều phối, rồi nối
 * `handleEvent` vào bus như `startOrchestratorLoop` (không bật sweep timer).
 * `seen` gom mọi event để test chấm.
 */
export function resetLoop(seen: DashboardEvent[]): void {
  _resetEventBusForTest()
  _resetOrchestratorForTest()
  seen.length = 0
  on('*', (e) => {
    seen.push(e)
    void handleEvent(e).catch(() => {})
  })
}

export function writePipeline(root: string, opts: { enabled?: boolean; gateOnReviewer?: boolean } = {}): void {
  const enabled = opts.enabled ?? true
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      ...(enabled ? ['orchestrator: { enabled: true, agent: " " }'] : []),
      'steps:',
      '  - { id: investigator, name: Investigate, agent: " " }',
      '  - { id: implementer, name: Implement, agent: " " }',
      opts.gateOnReviewer
        ? '  - { id: reviewer, name: Review, agent: " ", hitl: { mode: manual, gate_id: hitl-review } }'
        : '  - { id: reviewer, name: Review, agent: " " }',
    ].join('\n'),
    'utf8',
  )
}

export function seedTask(root: string, taskId: string, state: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), '# yêu cầu\n', 'utf8')
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: 'investigator', orchestrator_enabled: true, ...state }, null, 2),
    'utf8',
  )
}

export function stateOf(root: string, taskId: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, '.dev-state', `${taskId}.json`), 'utf8'))
}

/** Submit một job step như điều phối dispatch (vé `orchestratorDispatch`). */
export function submitStep(
  root: string,
  taskId: string,
  stepId: string,
  meta: Record<string, unknown> = {},
): JobRecord {
  return submitJob({
    agentRef: '',
    workspace: path.join(root, 'tasks', taskId),
    userPrompt: `chạy ${stepId}`,
    metadata: {
      projectRoot: path.dirname(root),
      devTeamRoot: root,
      projectId: PROJECT,
      taskId,
      pipelineStepId: stepId,
      orchestratorDispatch: true,
      ...meta,
    },
  })
}

/** Submit thẳng một job điều phối qua hàng đợi (TC-04 — không qua guard bận). */
export function submitOrchestratorJob(root: string, taskId: string, trigger = 'chat'): JobRecord {
  return submitJob({
    agentRef: '',
    workspace: path.join(root, 'tasks', taskId),
    userPrompt: `lượt ${trigger}`,
    metadata: {
      projectRoot: path.dirname(root),
      devTeamRoot: root,
      projectId: PROJECT,
      taskId,
      orchestratorJob: true,
      orchestratorTrigger: trigger,
      stepId: '__orchestrator__',
    },
  })
}

export function jobsOf(taskId: string): JobRecord[] {
  return listJobs(500).filter((j) => j.metadata?.taskId === taskId)
}

/** Lượt điều phối của task, theo thứ tự tạo (cũ → mới). */
export function turnsOf(taskId: string): JobRecord[] {
  return jobsOf(taskId)
    .filter((j) => j.metadata?.orchestratorJob === true)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

export function liveTurns(taskId: string): JobRecord[] {
  return turnsOf(taskId).filter((j) => j.status === 'queued' || j.status === 'running')
}

export function runningOf(taskId: string): JobRecord[] {
  return jobsOf(taskId).filter((j) => j.status === 'running')
}

export function statusOf(jobId: string): string | undefined {
  return loadJob(jobId)?.status
}

/** Chờ job vào `running` (provider đã nhận). */
export async function waitRunning(h: Harness, jobId: string): Promise<void> {
  await waitFor(() => h.started.includes(jobId) && statusOf(jobId) === 'running', `job ${jobId} running`)
}

/** Chờ job kết thúc (không còn queued/running). */
export async function waitSettled(jobId: string): Promise<JobRecord> {
  return waitFor(() => {
    const j = loadJob(jobId)
    return j && j.status !== 'queued' && j.status !== 'running' ? j : null
  }, `job ${jobId} settled`)
}
