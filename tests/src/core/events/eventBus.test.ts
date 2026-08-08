import { describe, expect, test, beforeEach } from 'bun:test'
import {
  emit,
  emitEntity,
  on,
  once,
  _resetEventBusForTest,
  registerTrigger,
  listTriggers,
  unregisterTrigger,
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

  test('once fires only once', () => {
    let count = 0
    once('job.queued', () => {
      count += 1
    })
    emit('job.queued', { jobId: 'a' })
    emit('job.queued', { jobId: 'b' })
    expect(count).toBe(1)
  })

  test('sync handler throw is isolated; other handlers still run', () => {
    const seen: string[] = []
    on('job.cancelled', () => {
      throw new Error('boom')
    })
    on('job.cancelled', (e) => {
      seen.push(e.type)
    })
    const event = emit('job.cancelled', { jobId: 'c1' })
    expect(event.type).toBe('job.cancelled')
    expect(seen).toEqual(['job.cancelled'])
  })

  test('unregister stops delivery', () => {
    const seen: string[] = []
    const off = on('job.failed', (e) => {
      seen.push(e.type)
    })
    off()
    emit('job.failed', { jobId: 'x' })
    expect(seen).toEqual([])
  })

  test('emitEntity publishes entity.* with entity field', () => {
    const seen: Array<Record<string, unknown>> = []
    on('entity.created', (e) => {
      seen.push(e.payload)
    })
    emitEntity('created', 'project', { id: 'p1', projectId: 'p1' })
    expect(seen).toEqual([{ entity: 'project', id: 'p1', projectId: 'p1' }])
  })

  test('trigger registry stub', () => {
    registerTrigger({ id: 't1', kind: 'webhook', match: 'webhook.received', enabled: true })
    expect(listTriggers()).toHaveLength(1)
    expect(unregisterTrigger('t1')).toBe(true)
    expect(listTriggers()).toHaveLength(0)
  })
})
