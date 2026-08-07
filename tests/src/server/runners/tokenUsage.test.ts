import { describe, expect, test } from 'bun:test'
import {
  estimateTokens,
  checkUsageGate,
  setUsageMode,
  recordUsage,
  aggregateUsage,
} from '../../../../src/features/runner/business/tokenUsage.js'
import os from 'node:os'
import path from 'node:path'

describe('tokenUsage', () => {
  test('estimate and aggregate', () => {
    const prev = process.env.DEV_TEAM_DASHBOARD_HOME
    process.env.DEV_TEAM_DASHBOARD_HOME = path.join(os.tmpdir(), `usage-${Date.now()}`)
    try {
      expect(estimateTokens('abcd')).toBe(1)
      expect(estimateTokens('a'.repeat(40))).toBe(10)
      setUsageMode('observe', 0)
      recordUsage({ inputTokens: 5, outputTokens: 5, totalTokens: 10, estimated: true })
      const agg = aggregateUsage()
      expect(agg.total).toBeGreaterThanOrEqual(10)
      setUsageMode('block', 1)
      const gate = checkUsageGate(100)
      expect(gate.ok).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
      else process.env.DEV_TEAM_DASHBOARD_HOME = prev
    }
  })
})
