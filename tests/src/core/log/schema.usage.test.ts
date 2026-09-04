import { describe, expect, test } from 'bun:test'
import {
  UsageLogEntry,
  UsageSnapshotSchema,
  parseLogLine,
} from '../../../../src/core/log/schema.js'

describe('UsageSnapshot / UsageLogEntry', () => {
  test('parses snapshot with estimatedCostUsd null', () => {
    const r = UsageSnapshotSchema.safeParse({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      estimatedCostUsd: null,
      model: 'claude-sonnet',
      provider: 'claude-code-cli',
      jobId: 'job-1',
    })
    expect(r.success).toBe(true)
  })

  test('rejects missing jobId', () => {
    const r = UsageSnapshotSchema.safeParse({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      estimatedCostUsd: null,
      model: null,
      provider: 'claude-code-cli',
    })
    expect(r.success).toBe(false)
  })

  test('parseLogLine accepts type usage', () => {
    const line = JSON.stringify({
      type: 'usage',
      ts: 1,
      iso: '2026-01-01T00:00:00.000Z',
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      estimatedCostUsd: null,
      model: null,
      provider: 'claude-code-cli',
      jobId: 'j1',
      source: 'aggregate',
    })
    const entry = parseLogLine(line)
    expect(entry?.type).toBe('usage')
    if (entry?.type === 'usage') {
      expect(entry.jobId).toBe('j1')
      expect(entry.estimatedCostUsd).toBeNull()
    }
  })

  test('UsageLogEntry rejects bad source', () => {
    const r = UsageLogEntry.safeParse({
      type: 'usage',
      ts: 1,
      iso: 'x',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      model: null,
      provider: 'claude-code-cli',
      jobId: 'j',
      source: 'nope',
    })
    expect(r.success).toBe(false)
  })
})
