import { describe, expect, test } from 'bun:test'
import { ref } from 'vue'
import {
  levelFromHttpStatus,
  parseLogLine,
  formatRequestQuery,
  formatResponsePreview,
  type LogEntry,
} from '../../../../../src/core/log/schema.js'
import { getTraceId, runWithTraceId } from '../../../../../src/core/log/traceContext.js'
import { useLogsTable } from '../../../../../src/features/logs/composables/useLogsTable'

describe('levelFromHttpStatus', () => {
  test('maps status bands', () => {
    expect(levelFromHttpStatus(200)).toBe('info')
    expect(levelFromHttpStatus(404)).toBe('warn')
    expect(levelFromHttpStatus(500)).toBe('error')
  })
})

describe('parseLogLine level/traceId defaults', () => {
  test('fills defaults for legacy request rows', () => {
    const entry = parseLogLine(
      JSON.stringify({
        type: 'request',
        ts: 1,
        iso: 't',
        method: 'GET',
        path: '/api/x',
        projectId: null,
        status: 200,
        durationMs: 1,
        error: null,
      }),
    )
    expect(entry).toMatchObject({
      type: 'request',
      level: 'info',
      traceId: '',
      query: '',
      response: '',
    })
  })
})

describe('formatRequestQuery / formatResponsePreview', () => {
  test('strips leading ? and truncates query', () => {
    expect(formatRequestQuery('?a=1&b=2')).toBe('a=1&b=2')
    expect(formatRequestQuery(`?${'x'.repeat(3000)}`).endsWith('…')).toBe(true)
  })

  test('previews json text and placeholders binary', () => {
    expect(formatResponsePreview(Buffer.from('{"ok":true}'), 'application/json')).toBe('{"ok":true}')
    expect(formatResponsePreview(Buffer.from([0, 1, 2]), 'application/octet-stream')).toContain('binary')
  })
})

describe('traceContext', () => {
  test('runWithTraceId binds getTraceId', () => {
    expect(getTraceId()).toBeNull()
    runWithTraceId('trace-abc', () => {
      expect(getTraceId()).toBe('trace-abc')
    })
    expect(getTraceId()).toBeNull()
  })
})

describe('useLogsTable', () => {
  function sample(): LogEntry[] {
    return [
      {
        type: 'request',
        ts: 2,
        iso: '2026-01-02',
        level: 'error',
        traceId: 'aaa-111',
        method: 'POST',
        path: '/api/b',
        query: 'x=1',
        response: '{"ok":false}',
        projectId: 'p1',
        status: 500,
        durationMs: 9,
        error: 'x',
      },
      {
        type: 'request',
        ts: 1,
        iso: '2026-01-01',
        level: 'info',
        traceId: 'bbb-222',
        method: 'GET',
        path: '/api/a',
        query: '',
        response: '{"ok":true}',
        projectId: null,
        status: 200,
        durationMs: 3,
        error: null,
      },
    ]
  }

  test('filters by level and traceId', () => {
    const entries = ref(sample())
    const table = useLogsTable(entries)
    table.setLevelFilter('error')
    expect(table.displayed.value.map((e) => e.traceId)).toEqual(['aaa-111'])
    table.clearFilters()
    table.filters.value = { ...table.filters.value, traceId: 'bbb' }
    expect(table.displayed.value).toHaveLength(1)
    expect(table.displayed.value[0].path).toBe('/api/a')
  })

  test('sorts by clicked column', () => {
    const entries = ref(sample())
    const table = useLogsTable(entries)
    table.toggleSort('path')
    expect(table.displayed.value.map((e) => (e.type === 'request' ? e.path : ''))).toEqual([
      '/api/a',
      '/api/b',
    ])
    table.toggleSort('path')
    expect(table.displayed.value.map((e) => (e.type === 'request' ? e.path : ''))).toEqual([
      '/api/b',
      '/api/a',
    ])
  })

  test('Shift+click appends secondary sort columns', () => {
    const entries = ref<LogEntry[]>([
      {
        type: 'request',
        ts: 1,
        iso: 'a',
        level: 'info',
        traceId: 't1',
        method: 'GET',
        path: '/z',
        query: '',
        response: '',
        projectId: null,
        status: 200,
        durationMs: 1,
        error: null,
      },
      {
        type: 'request',
        ts: 2,
        iso: 'b',
        level: 'info',
        traceId: 't2',
        method: 'GET',
        path: '/a',
        query: '',
        response: '',
        projectId: null,
        status: 200,
        durationMs: 1,
        error: null,
      },
      {
        type: 'request',
        ts: 3,
        iso: 'c',
        level: 'warn',
        traceId: 't3',
        method: 'POST',
        path: '/m',
        query: '',
        response: '',
        projectId: null,
        status: 400,
        durationMs: 1,
        error: null,
      },
    ])
    const table = useLogsTable(entries)
    table.toggleSort('method') // primary: GET before POST (asc)
    table.toggleSort('path', { append: true }) // secondary: path asc among ties
    expect(table.sortSpecs.value).toEqual([
      { key: 'method', dir: 'asc' },
      { key: 'path', dir: 'asc' },
    ])
    expect(table.sortIndicator('method')).toBe('↑1')
    expect(table.sortIndicator('path')).toBe('↑2')
    expect(table.displayed.value.map((e) => (e.type === 'request' ? e.path : ''))).toEqual([
      '/a',
      '/z',
      '/m',
    ])
    // Plain click replaces multi-sort
    table.toggleSort('status')
    expect(table.sortSpecs.value).toEqual([{ key: 'status', dir: 'asc' }])
  })
})
