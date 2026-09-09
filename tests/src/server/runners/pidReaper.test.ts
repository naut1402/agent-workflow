import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { reapOrphanedRunningJobs, isPidAlive } from '../../../../src/features/runner/business/jobQueue.js'
import { saveRecoverEntry } from '../../../../src/features/runner/business/recoverLedger.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const JOB = 'cccccccc-bbbb-4ccc-dddd-eeeeeeeeeeee'
const JOB2 = 'dddddddd-bbbb-4ccc-dddd-eeeeeeeeeeee'

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-reaper-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(path.join(home, 'jobs'), { recursive: true })
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('pidReaper', () => {
  test('isPidAlive false for missing pid', () => {
    expect(isPidAlive(null)).toBe(false)
    expect(isPidAlive(999999999)).toBe(false)
  })

  test('reapOrphanedRunningJobs marks dead running jobs failed', () => {
    fs.writeFileSync(
      path.join(home, 'jobs', `${JOB}.json`),
      JSON.stringify({
        id: JOB,
        status: 'running',
        pid: 999999999,
        runnerId: 'r1',
        agentRef: 'x',
        workspace: home,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        attemptCount: 3,
      }),
      'utf8',
    )
    const reaped = reapOrphanedRunningJobs()
    expect(reaped.length).toBe(1)
    expect(reaped[0].status).toBe('failed')
    expect(reaped[0].error).toContain('orphaned')
  })

  test('orphan with recover entry stays awaiting_recovery', () => {
    fs.writeFileSync(
      path.join(home, 'jobs', `${JOB2}.json`),
      JSON.stringify({
        id: JOB2,
        status: 'running',
        pid: 999999999,
        runnerId: 'r1',
        agentRef: 'x',
        workspace: home,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
      }),
      'utf8',
    )
    saveRecoverEntry({
      version: 1,
      jobId: JOB2,
      kind: 'usage_limit',
      attemptCount: 0,
      resumeAfter: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    const reaped = reapOrphanedRunningJobs()
    expect(reaped.length).toBe(1)
    expect(reaped[0].status).toBe('awaiting_recovery')
    expect(reaped[0].status).not.toBe('failed')
  })

  test('orphan without recover entry retries when attempts remain', () => {
    const JOB3 = 'eeeeeeee-bbbb-4ccc-dddd-eeeeeeeeeeee'
    fs.writeFileSync(
      path.join(home, 'jobs', `${JOB3}.json`),
      JSON.stringify({
        id: JOB3,
        status: 'running',
        pid: 999999999,
        runnerId: 'r1',
        agentRef: 'x',
        workspace: home,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        attemptCount: 0,
      }),
      'utf8',
    )
    const reaped = reapOrphanedRunningJobs()
    const r = reaped.find((j) => j.id === JOB3)
    expect(r?.status).toBe('queued')
    expect(r?.attemptCount).toBe(1)
  })
})
