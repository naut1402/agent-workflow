import { describe, expect, test, beforeEach } from 'bun:test'
import {
  emit,
  on,
  _resetEventBusForTest,
  registerTrigger,
  listTriggers,
  _resetTriggersForTest,
} from '../../../../src/core/events/index.js'

describe('eventBus', () => {
  beforeEach(() => {
    _resetEventBusForTest()
    _resetTriggersForTest()
  })

  test('emit delivers to typed and wildcard handlers', () => {
    const seen: string[] = []
    on('job.started', (e) => {
      seen.push(e.type)
    })
    on('*', (e) => {
      seen.push(`*:${e.type}`)
    })
    emit('job.started', { jobId: '1' })
    expect(seen).toEqual(['job.started', '*:job.started'])
  })

  test('trigger registry stub', () => {
    registerTrigger({ id: 't1', kind: 'webhook', match: 'webhook.received', enabled: true })
    expect(listTriggers()).toHaveLength(1)
  })
})
