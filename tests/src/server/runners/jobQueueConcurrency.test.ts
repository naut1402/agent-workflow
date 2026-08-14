import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

// Per-task concurrency: jobs for different taskIds must overlap; same taskId stays serial.

const PROVIDER_ID = 'stub-job-queue-concurrency'
const DELAY_MS = 80

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 8 }),
  async execute(_req: ExecuteRequest): Promise<ExecuteResult> {
    await new Promise((r) => setTimeout(r, DELAY_MS))
    return { ok: true, exitCode: 0, durationMs: DELAY_MS }
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
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-job-queue-conc-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-conc', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-conc', connectionId: 'stub-conn-conc', config: {} })
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

describe('jobQueue per-task concurrency', () => {
  test('jobs for different taskIds run in parallel (startedAt overlaps)', async () => {
    const a = submitJob({
      runnerId: 'stub-runner-conc',
      agentRef: '',
      workspace: home,
      userPrompt: 'a',
      metadata: { taskId: 'TASK-A' },
    })
    const b = submitJob({
      runnerId: 'stub-runner-conc',
      agentRef: '',
      workspace: home,
      userPrompt: 'b',
      metadata: { taskId: 'TASK-B' },
    })

    const wallStart = Date.now()
    await Promise.all([settle(a.id), settle(b.id)])
    const wall = Date.now() - wallStart

    const ja = loadJob(a.id)!
    const jb = loadJob(b.id)!
    expect(ja.status).toBe('succeeded')
    expect(jb.status).toBe('succeeded')
    expect(ja.startedAt).toBeTruthy()
    expect(jb.startedAt).toBeTruthy()
    const startA = Date.parse(ja.startedAt!)
    const startB = Date.parse(jb.startedAt!)
    const finishA = Date.parse(ja.finishedAt!)
    const finishB = Date.parse(jb.finishedAt!)
    // Overlap: each started before the other finished.
    expect(startA < finishB && startB < finishA).toBe(true)
    // Parallel wall clock should be well under serial 2× delay.
    expect(wall).toBeLessThan(DELAY_MS * 2 - 20)
  })

  test('jobs for the same taskId stay serial', async () => {
    const a = submitJob({
      runnerId: 'stub-runner-conc',
      agentRef: '',
      workspace: home,
      userPrompt: 'a',
      metadata: { taskId: 'TASK-SAME' },
    })
    const b = submitJob({
      runnerId: 'stub-runner-conc',
      agentRef: '',
      workspace: home,
      userPrompt: 'b',
      metadata: { taskId: 'TASK-SAME' },
    })

    // While A is running, B must remain queued (not running).
    for (let i = 0; i < 200 && loadJob(a.id)?.status !== 'running'; i++) await sleep(5)
    expect(loadJob(a.id)?.status).toBe('running')
    expect(loadJob(b.id)?.status).toBe('queued')

    await settle(a.id)
    await settle(b.id)
    const ja = loadJob(a.id)!
    const jb = loadJob(b.id)!
    expect(Date.parse(jb.startedAt!)).toBeGreaterThanOrEqual(Date.parse(ja.finishedAt!))
  })
})
