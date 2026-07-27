import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { reapOrphanedRunningJobs, isPidAlive } from '../../../server/runners/pidReaper.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const JOB = 'cccccccc-bbbb-4ccc-dddd-eeeeeeeeeeee'

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
      }),
      'utf8',
    )
    const reaped = reapOrphanedRunningJobs()
    expect(reaped.length).toBe(1)
    expect(reaped[0].status).toBe('failed')
    expect(reaped[0].error).toContain('orphaned')
  })
})
