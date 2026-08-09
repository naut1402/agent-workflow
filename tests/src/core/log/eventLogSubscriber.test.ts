import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emit, _resetEventBusForTest } from '../../../../src/core/events/eventBus.js'
import {
  invalidateLoggingPrefsCache,
} from '../../../../src/core/log/loggingPrefs.js'
import {
  registerEventLogSubscriber,
  _resetEventLogSubscriberForTest,
} from '../../../../src/core/log/eventLogSubscriber.js'
import { readLogs } from '../../../../src/features/logs/business/store.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function writeSettings(logging: unknown) {
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({ logging }, null, 2),
  )
  invalidateLoggingPrefsCache()
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-event-log-sub-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
  try {
    fs.unlinkSync(path.join(home, 'settings.json'))
  } catch {
    /* ignore */
  }
  invalidateLoggingPrefsCache()
  _resetEventLogSubscriberForTest()
  _resetEventBusForTest()
})

describe('eventLogSubscriber', () => {
  test('does not write when events prefs off (default)', async () => {
    registerEventLogSubscriber()
    emit('job.started', { jobId: 'j1', projectId: 'p1' })
    await new Promise((r) => setTimeout(r, 40))
    expect(await readLogs({ type: 'events' })).toEqual([])
  })

  test('writes JSONL when events prefs on', async () => {
    writeSettings({ types: { events: true } })
    registerEventLogSubscriber()
    emit('entity.created', { entity: 'project', id: 'p1', projectId: 'p1' })
    await new Promise((r) => setTimeout(r, 40))
    const entries = await readLogs({ type: 'events' })
    expect(entries.length).toBe(1)
    expect(entries[0]).toMatchObject({
      type: 'events',
      event: 'entity.created',
      projectId: 'p1',
      payload: { entity: 'project', id: 'p1', projectId: 'p1' },
    })
  })

  test('registerEventLogSubscriber is idempotent', async () => {
    writeSettings({ types: { events: true } })
    registerEventLogSubscriber()
    registerEventLogSubscriber()
    emit('job.queued', { jobId: 'q1' })
    await new Promise((r) => setTimeout(r, 40))
    expect(await readLogs({ type: 'events' })).toHaveLength(1)
  })
})
