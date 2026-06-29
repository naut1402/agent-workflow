import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJobLog } from '../../../server/logging/jobLog.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const UUID = '11111111-2222-4333-8444-555555555555'

function jobLogFile(id: string) {
  return path.join(home, 'jobs', `${id}.log`)
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-joblog-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(path.join(home, 'jobs'), { recursive: true })
})
afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('logging/jobLog', () => {
  test('reads a small log fully', async () => {
    fs.writeFileSync(jobLogFile(UUID), 'line one\nline two\n')
    const r = await readJobLog(UUID)
    expect(r).toMatchObject({ ok: true, truncated: false })
    if (r.ok) expect(r.text).toContain('line two')
  })

  test('tails a large log and flags truncated', async () => {
    const big = 'x'.repeat(200 * 1024)
    fs.writeFileSync(jobLogFile(UUID), big)
    const r = await readJobLog(UUID, 64 * 1024)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.truncated).toBe(true)
      expect(r.text.length).toBe(64 * 1024)
      expect(r.size).toBe(big.length)
    }
  })

  test('missing file → empty ok (not 404)', async () => {
    const r = await readJobLog('99999999-2222-4333-8444-555555555555')
    expect(r).toMatchObject({ ok: true, text: '', size: 0 })
  })

  test.each(['../../etc/passwd', 'a/b', '..', 'not-a-uuid', ''])(
    'rejects traversal / non-uuid id: %p',
    async (bad) => {
      const r = await readJobLog(bad)
      expect(r).toMatchObject({ ok: false, status: 400 })
    },
  )
})
