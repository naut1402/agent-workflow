import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cancelJob, loadJob, registerProvider, submitJob, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

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
