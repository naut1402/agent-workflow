import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cancelJob, loadJob, registerProvider, submitJob, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, JobRecord, JobStatus, RunnerProvider } from '../../../../src/features/runner/business/types.js'
import { on, _resetEventBusForTest } from '../../../../src/core/events/index.js'

// `cancelJob` has no OS pid to SIGTERM for providers with no subprocess
// (AgenticApiProvider subclasses — see providers/agenticApiProvider.ts, which
// run the model call in-process). This stub stands in for one of those: it
// never resolves on its own, only when `req.signal` fires — the same contract
// AgenticApiProvider.execute() relies on to thread cancellation into
// fetch/SDK calls (openai-compatible-api.ts / anthropic-compatible-api.ts).

const PROVIDER_ID = 'stub-abortable-ai-provider'

let sawAbort = false
let executeStarted: () => void
const executeStartedPromise = new Promise<void>((resolve) => {
  executeStarted = resolve
})

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  family: 'ai-api',
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    executeStarted()
    await new Promise<void>((resolve) => {
      if (req.signal?.aborted) {
        sawAbort = true
        resolve()
        return
      }
      req.signal?.addEventListener('abort', () => {
        sawAbort = true
        resolve()
      })
    })
    return { ok: false, exitCode: null, durationMs: 0, error: 'aborted' }
  },
}

let home: string
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

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-job-cancel-abort-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  // `local-console` so `credentialForConnection` synthesizes a credential
  // without needing a real CredentialProfile on disk — the connection `kind`
  // is unrelated to whether `runJob` threads `req.signal` through, which is
  // what this test actually exercises.
  upsertConnection({ id: 'stub-conn-abort', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-abort', connectionId: 'stub-conn-abort', config: {} })
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

describe('cancelJob aborts an in-flight non-subprocess provider', () => {
  test('cancelling a running job fires req.signal, and the job stays cancelled once execute() settles', async () => {
    const job = submitJob({
      runnerId: 'stub-runner-abort',
      agentRef: '',
      workspace: home,
      userPrompt: 'do work',
      metadata: { taskId: 'TASK-ABORT' },
    })

    await executeStartedPromise
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)
    expect(loadJob(job.id)?.status).toBe('running')

    const cancelResult = cancelJob(job.id)
    expect(cancelResult.ok).toBe(true)
    expect(loadJob(job.id)?.status).toBe('cancelled')

    const finished = await settle(job.id)
    expect(sawAbort).toBe(true)
    // `runJob`'s cancelled-guard must win — execute()'s `{ok:false}` result
    // must not overwrite the job back to `failed`.
    expect(finished.status).toBe('cancelled')
  })
})

// ── TC-12 (nợ roadmap 1.1.0 §5): `job.cancelled` chỉ phát khi cancel thật sự
// đổi trạng thái job. Bất biến event kernel (docs/event-catalog.md): thao tác
// no-op không phát event, và emit chỉ sau khi persist thành công.
//
// Job được ghi thẳng vào `jobs/` (không qua submitJob) để cố định trạng thái
// đầu vào: cancelJob đọc bản ghi từ đĩa, nên không cần queue/runner tham gia và
// case không phụ thuộc thời gian.

function writeSeedJob(id: string, status: JobStatus, extra: Partial<JobRecord> = {}): void {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  const job: JobRecord = {
    id,
    status,
    runnerId: 'stub-runner-abort',
    agentRef: '',
    workspace: home,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    finishedAt: null,
    exitCode: null,
    pid: null,
    metadata: { taskId: 'TASK-NOEMIT', projectId: 'proj-noemit' },
    ...extra,
  }
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(job), 'utf8')
}

/** Thu mọi `job.cancelled` phát ra trong lúc chạy case. */
function captureCancelled(): Array<Record<string, unknown>> {
  const seen: Array<Record<string, unknown>> = []
  on('job.cancelled', (e) => {
    seen.push(e.payload as Record<string, unknown>)
  })
  return seen
}

describe('cancelJob does not emit job.cancelled on a no-op', () => {
  beforeEach(() => {
    _resetEventBusForTest()
  })
  afterEach(() => {
    _resetEventBusForTest()
  })

  test.each([
    ['succeeded', 'succeeded'],
    ['failed', 'failed'],
  ] as const)('cancel a %s job → 400 "job already finished", no emit, status unchanged', (_label, status) => {
    const id = `finished-${status}`
    writeSeedJob(id, status, { finishedAt: '2026-01-01T00:05:00.000Z', exitCode: status === 'succeeded' ? 0 : 1 })
    const seen = captureCancelled()

    expect(cancelJob(id)).toEqual({ ok: false, status: 400, error: 'job already finished' })
    expect(seen).toEqual([])
    expect(loadJob(id)?.status).toBe(status)
  })

  test('cancel an already-cancelled job → ok (idempotent), no re-emit', () => {
    writeSeedJob('already-cancelled', 'cancelled', { finishedAt: '2026-01-01T00:05:00.000Z' })
    const seen = captureCancelled()

    expect(cancelJob('already-cancelled')).toEqual({ ok: true })
    expect(seen).toEqual([])
    expect(loadJob('already-cancelled')?.status).toBe('cancelled')
  })

  test('cancel an unknown job → 404, no emit', () => {
    const seen = captureCancelled()

    expect(cancelJob('no-such-job')).toEqual({ ok: false, status: 404, error: 'not found' })
    expect(seen).toEqual([])
  })

  // Đối chứng dương: nếu thiếu case này thì "không emit" có thể xanh vì bus
  // hỏng chứ không vì cancelJob đúng.
  test.each(['queued', 'running'] as const)(
    'cancel a %s job → emits job.cancelled exactly once with jobId/taskId/projectId',
    (status) => {
      const id = `live-${status}`
      writeSeedJob(id, status)
      const seen = captureCancelled()

      expect(cancelJob(id)).toEqual({ ok: true })
      expect(seen).toEqual([{ jobId: id, taskId: 'TASK-NOEMIT', projectId: 'proj-noemit' }])
      expect(loadJob(id)?.status).toBe('cancelled')
    },
  )

  test('cancelling twice emits only once (second call is the idempotent branch)', () => {
    writeSeedJob('cancel-twice', 'queued')
    const seen = captureCancelled()

    expect(cancelJob('cancel-twice')).toEqual({ ok: true })
    expect(cancelJob('cancel-twice')).toEqual({ ok: true })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ jobId: 'cancel-twice' })
  })
})
