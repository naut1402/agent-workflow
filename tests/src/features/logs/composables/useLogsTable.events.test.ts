import { describe, expect, test } from 'vitest'
import { ref } from 'vue'
import { parseLogLine, type LogEntry } from '@/core/log/schema'
import { useLogsTable } from '@/features/logs/composables/useLogsTable'

/** Isolated from useLogsTable.test.ts (traceContext / node: builtins break vitest load). */

describe('events log schema + table', () => {
  test('parseLogLine fills defaults for events rows', () => {
    const entry = parseLogLine(
      JSON.stringify({
        type: 'events',
        ts: 1,
        iso: 't',
        event: 'job.queued',
        projectId: 'p1',
      }),
    )
    expect(entry).toMatchObject({
      type: 'events',
      event: 'job.queued',
      level: 'info',
      traceId: '',
      payload: {},
      projectId: 'p1',
    })
  })

  test('filters events by event name / payload text', () => {
    const entries = ref<LogEntry[]>([
      {
        type: 'events',
        ts: 2,
        iso: 'b',
        level: 'info',
        traceId: '',
        event: 'job.started',
        payload: { id: 'j1' },
        projectId: null,
      },
      {
        type: 'events',
        ts: 1,
        iso: 'a',
        level: 'info',
        traceId: '',
        event: 'entity.created',
        payload: { entity: 'project', id: 'p1' },
        projectId: 'p1',
      },
    ])
    const table = useLogsTable(entries)
    table.filters.value = { ...table.filters.value, q: 'entity.created' }
    expect(table.displayed.value).toHaveLength(1)
    expect(table.displayed.value[0]).toMatchObject({ type: 'events', event: 'entity.created' })
    table.filters.value = { ...table.filters.value, q: 'j1' }
    expect(table.displayed.value).toHaveLength(1)
    expect(table.displayed.value[0]).toMatchObject({ type: 'events', event: 'job.started' })
  })
})
