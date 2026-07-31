import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readJobLogDelta,
  readTaskJobLogDelta,
  resolveTaskJobId,
} from '../../../../../src/features/logs/server/jobLog.js'
import { submitJob, loadJob } from '../../../../../src/server/runners/jobQueue.js'
import { upsertRunner } from '../../../../../src/server/runners/registry.js'
import { DEFAULT_CONNECTION_ID } from '../../../../../src/server/runners/types.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const JOB_A = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee'
const JOB_B = 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee'

function jobLogFile(id: string) {
  return path.join(home, 'jobs', `${id}.log`)
}

function jobFile(id: string) {
  return path.join(home, 'jobs', `${id}.json`)
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-joblog-delta-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(path.join(home, 'jobs'), { recursive: true })
  upsertRunner({ id: 'test-runner', connectionId: DEFAULT_CONNECTION_ID } as any)
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('logging/jobLogDelta', () => {
  test('offset returns delta from cursor', async () => {
    fs.writeFileSync(jobLogFile(JOB_A), 'alpha\nbeta\n')
    const r = await readJobLogDelta(JOB_A, { offset: 6 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe('beta\n')
      expect(r.from).toBe(6)
      expect(r.size).toBe(11)
      expect(r.reset).toBe(false)
      expect(r.hasMore).toBe(false)
    }
  })

  test('size < offset → reset true', async () => {
    fs.writeFileSync(jobLogFile(JOB_A), 'fresh log\n')
    const r = await readJobLogDelta(JOB_A, { offset: 9999 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reset).toBe(true)
      expect(r.from).toBe(0)
      expect(r.text).toBe('fresh log\n')
    }
  })

  test('cap 256KB chunk + hasMore', async () => {
    const chunk = 'z'.repeat(300 * 1024)
    fs.writeFileSync(jobLogFile(JOB_A), chunk)
    const r = await readJobLogDelta(JOB_A, { offset: 0 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text.length).toBe(256 * 1024)
      expect(r.hasMore).toBe(true)
    }
  })

  test('includes status and exitCode from job record', async () => {
    fs.writeFileSync(jobLogFile(JOB_A), 'done\n')
    fs.writeFileSync(
      jobFile(JOB_A),
      JSON.stringify({
        id: JOB_A,
        status: 'succeeded',
        exitCode: 0,
        runnerId: 'test-runner',
        agentRef: 'x',
        workspace: home,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }),
      'utf8',
    )
    const r = await readJobLogDelta(JOB_A, { offset: 0 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status).toBe('succeeded')
      expect(r.exitCode).toBe(0)
      expect(r.eof).toBe(true)
    }
  })

  test('wait timeout returns without hanging', async () => {
    fs.writeFileSync(jobLogFile(JOB_A), 'start\n')
    fs.writeFileSync(
      jobFile(JOB_A),
      JSON.stringify({
        id: JOB_A,
        status: 'running',
        exitCode: null,
        runnerId: 'test-runner',
        agentRef: 'x',
        workspace: home,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
      }),
      'utf8',
    )
    const t0 = Date.now()
    const r = await readJobLogDelta(JOB_A, { offset: 6, waitMs: 50 })
    expect(r.ok).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2000)
    if (r.ok) expect(r.text).toBe('')
  })

  test('resolveTaskJobId prefers running job for same taskId', () => {
    const now = new Date().toISOString()
    fs.writeFileSync(
      jobFile(JOB_A),
      JSON.stringify({
        id: JOB_A,
        status: 'running',
        runnerId: 'test-runner',
        agentRef: 'x',
        workspace: home,
        metadata: { taskId: 'T-DELTA' },
        createdAt: now,
        startedAt: now,
        finishedAt: null,
        exitCode: null,
      }),
      'utf8',
    )
    fs.writeFileSync(
      jobFile(JOB_B),
      JSON.stringify({
        id: JOB_B,
        status: 'succeeded',
        runnerId: 'test-runner',
        agentRef: 'x',
        workspace: home,
        metadata: { taskId: 'T-DELTA' },
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        exitCode: 0,
      }),
      'utf8',
    )
    expect(resolveTaskJobId('T-DELTA')).toBe(JOB_A)
  })

  test('readTaskJobLogDelta streams from active task job', async () => {
    fs.writeFileSync(jobLogFile(JOB_B), 'task-level line\n')
    fs.writeFileSync(
      jobFile(JOB_B),
      JSON.stringify({
        id: JOB_B,
        status: 'running',
        runnerId: 'test-runner',
        agentRef: 'x',
        workspace: home,
        metadata: { taskId: 'T-STREAM' },
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
      }),
      'utf8',
    )
    const r = await readTaskJobLogDelta('T-STREAM', { offset: 0 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.jobId).toBe(JOB_B)
      expect(r.text).toContain('task-level')
    }
  })

  test('submitJob stores inputSessionMode when sessionMode provided', () => {
    const job = submitJob({
      agentRef: 'noref',
      workspace: home,
      sessionMode: 'resume',
      sessionId: 'sess-x',
      metadata: { taskId: 'T1', projectId: 'p1' },
    })
    expect(job.metadata?.inputSessionMode).toBe('resume')
    expect(job.metadata?.inputSessionId).toBe('sess-x')
    expect(loadJob(job.id)?.metadata?.inputSessionMode).toBe('resume')
  })
})
