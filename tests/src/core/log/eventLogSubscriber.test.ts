import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emit, _resetEventBusForTest } from '../../../../src/core/events/index.js'
import {
  installEventLogSubscriber,
  uninstallEventLogSubscriberForTest,
  prepareEventPayload,
} from '../../../../src/core/log/eventLogSubscriber.js'
import { invalidateLoggingPrefsCache } from '../../../../src/core/log/loggingPrefs.js'
import { readLogs } from '../../../../src/features/logs/business/store.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function writeSettings(logging: unknown) {
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ logging }, null, 2))
  invalidateLoggingPrefsCache()
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-evtlog-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  uninstallEventLogSubscriberForTest()
  _resetEventBusForTest()
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
  _resetEventBusForTest()
  uninstallEventLogSubscriberForTest()
  installEventLogSubscriber()
})

describe('prepareEventPayload', () => {
  test('redacts sensitive keys', () => {
    expect(prepareEventPayload({ token: 'secret', id: 'j1' })).toEqual({
      token: '[redacted]',
      id: 'j1',
    })
  })
})

describe('event log subscriber', () => {
  test('emit task.created → events.jsonl when prefs on', async () => {
    writeSettings({ types: { events: true } })
    emit('task.created', { taskId: 'T1', projectId: 'p1' })
    await new Promise((r) => setTimeout(r, 40))
    const entries = await readLogs({ type: 'events' })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      type: 'events',
      event: 'task.created',
      projectId: 'p1',
    })
  })

  test('emit job.started is persisted', async () => {
    writeSettings({ types: { events: true } })
    emit('job.started', { jobId: 'j1', projectId: 'p1', taskId: 'T1' })
    await new Promise((r) => setTimeout(r, 40))
    const entries = await readLogs({ type: 'events' })
    expect(entries[0]).toMatchObject({ event: 'job.started', projectId: 'p1' })
  })

  test('no write when events prefs off', async () => {
    writeSettings({ types: { events: false } })
    emit('task.created', { taskId: 'T1', projectId: 'p1' })
    await new Promise((r) => setTimeout(r, 40))
    expect(await readLogs({ type: 'events' })).toEqual([])
  })
})
