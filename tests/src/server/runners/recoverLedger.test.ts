import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  saveRecoverEntry,
  loadRecoverEntry,
  removeRecoverEntry,
  listRecoverEntries,
} from '../../../../src/features/runner/business/recoverLedger.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const JOB = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee'

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-recover-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('recoverLedger', () => {
  test('save/load round-trip', () => {
    const entry = {
      version: 1 as const,
      jobId: JOB,
      kind: 'usage_limit' as const,
      attemptCount: 0,
      resumeAfter: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lastError: 'limit hit',
    }
    saveRecoverEntry(entry)
    expect(loadRecoverEntry(JOB)).toEqual(entry)
    expect(fs.existsSync(path.join(home, 'recover', `${JOB}.json.tmp`))).toBe(false)
  })

  test('remove clears entry', () => {
    saveRecoverEntry({
      version: 1,
      jobId: JOB,
      kind: 'network',
      attemptCount: 0,
      resumeAfter: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    removeRecoverEntry(JOB)
    expect(loadRecoverEntry(JOB)).toBe(null)
  })

  test('list skips corrupt files', () => {
    fs.mkdirSync(path.join(home, 'recover'), { recursive: true })
    fs.writeFileSync(path.join(home, 'recover', 'bad.json'), '{not json', 'utf8')
    saveRecoverEntry({
      version: 1,
      jobId: 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee',
      kind: 'process_crash',
      attemptCount: 1,
      resumeAfter: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    const listed = listRecoverEntries()
    expect(listed).toHaveLength(1)
    expect(listed[0].jobId).toBe('bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee')
  })
})
