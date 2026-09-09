import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  bindRecoverPoller,
  resumeRecoveredJob,
  tickRecoverPoller,
} from '../../../../src/features/runner/business/recoverPoller.js'
import {
  saveRecoverEntry,
  loadRecoverEntry,
} from '../../../../src/features/runner/business/recoverLedger.js'
import { loadJob, FAILURE_MAX_ATTEMPTS } from '../../../../src/features/runner/business/jobQueue.js'
import { classifyJobFailure } from '../../../../src/features/runner/business/classifyJobFailure.js'
import type { ExecuteResult } from '../../../../src/features/runner/business/types.js'
import { on, type DashboardEvent } from '../../../../src/core/events/index.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const JOB = 'dddddddd-bbbb-4ccc-dddd-eeeeeeeeeeee'

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-job-recovery-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(path.join(home, 'jobs'), { recursive: true })

  const requeued: string[] = []
  bindRecoverPoller({
    loadJob,
    saveJob: (job) => {
      fs.writeFileSync(path.join(home, 'jobs', `${job.id}.json`), JSON.stringify(job), 'utf8')
      return job
    },
    requeueJob: (id) => {
      requeued.push(id)
    },
  })
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

function seedJob(overrides: Record<string, unknown> = {}) {
  const job = {
    id: JOB,
    status: 'awaiting_recovery',
    runnerId: 'r1',
    agentRef: 'x',
    workspace: home,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: 1,
    attemptCount: 0,
    ...overrides,
  }
  fs.writeFileSync(path.join(home, 'jobs', `${JOB}.json`), JSON.stringify(job), 'utf8')
  return job
}

describe('jobRecovery', () => {
  test('classifyJobFailure four branches', () => {
    const usage: ExecuteResult = { ok: false, exitCode: 1, durationMs: 1, error: 'usage limit' }
    const network: ExecuteResult = { ok: false, exitCode: null, durationMs: 1, error: 'ECONNRESET' }
    const crash: ExecuteResult = { ok: false, exitCode: null, durationMs: 1, error: 'ENOENT' }
    const verdict: ExecuteResult = { ok: false, exitCode: 1, durationMs: 1, error: 'task failed' }
    expect(classifyJobFailure(usage)).toBe('usage_limit')
    expect(classifyJobFailure(network)).toBe('network')
    expect(classifyJobFailure(crash)).toBe('process_crash')
    expect(classifyJobFailure(verdict)).toBe(null)
  })

  test('FAILURE_MAX_ATTEMPTS is 3', () => {
    expect(FAILURE_MAX_ATTEMPTS).toBe(3)
  })

  test('resumeRecoveredJob re-queues when resumeAfter passed', async () => {
    seedJob({ status: 'awaiting_recovery' })
    saveRecoverEntry({
      version: 1,
      jobId: JOB,
      kind: 'usage_limit',
      attemptCount: 0,
      resumeAfter: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    await resumeRecoveredJob(JOB)
    expect(loadRecoverEntry(JOB)).toBe(null)
    const job = loadJob(JOB)
    expect(job?.status).toBe('queued')
  })

  test('resumeRecoveredJob emits job.recovered', async () => {
    seedJob({ status: 'awaiting_recovery' })
    saveRecoverEntry({
      version: 1,
      jobId: JOB,
      kind: 'network',
      attemptCount: 0,
      resumeAfter: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    const seen: DashboardEvent[] = []
    const off = on('job.recovered', (e) => {
      seen.push(e)
    })
    try {
      await resumeRecoveredJob(JOB)
    } finally {
      off()
    }
    expect(seen).toHaveLength(1)
    expect(seen[0].payload).toMatchObject({ jobId: JOB, kind: 'network' })
  })

  test('tickRecoverPoller skips future resumeAfter', async () => {
    seedJob({ status: 'awaiting_recovery' })
    saveRecoverEntry({
      version: 1,
      jobId: JOB,
      kind: 'network',
      attemptCount: 0,
      resumeAfter: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    await tickRecoverPoller()
    expect(loadRecoverEntry(JOB)).not.toBe(null)
    expect(loadJob(JOB)?.status).toBe('awaiting_recovery')
  })
})
