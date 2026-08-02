import { afterEach, describe, expect, test } from 'bun:test'
import {
  appendLog,
  getLogDriver,
  resetLogDriver,
  setLogDriver,
  type LogEntry,
} from '../../../../src/core/log/index.js'

afterEach(() => {
  resetLogDriver()
})

describe('core/log driver', () => {
  test('default driver is file-backed (append does not throw)', async () => {
    expect(typeof getLogDriver().append).toBe('function')
    await appendLog({
      type: 'request',
      ts: 1,
      iso: 'x',
      method: 'GET',
      path: '/ping',
      projectId: null,
      status: 200,
      durationMs: 0,
      error: null,
    })
  })

  test('setLogDriver redirects append', async () => {
    const seen: LogEntry[] = []
    setLogDriver({
      append: async (entry) => {
        seen.push(entry)
      },
    })
    await appendLog({
      type: 'audit',
      ts: 2,
      iso: 'y',
      op: 'update',
      entity: 'project',
      identifier: 'p1',
      projectId: 'p1',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ type: 'audit', entity: 'project' })
  })
})
