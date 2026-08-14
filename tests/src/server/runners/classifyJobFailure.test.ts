import { describe, expect, test } from 'bun:test'
import {
  classifyJobFailure,
  parseUsageResetAt,
} from '../../../../src/features/runner/business/classifyJobFailure.js'
import type { ExecuteResult } from '../../../../src/features/runner/business/types.js'

function fail(partial: Partial<ExecuteResult> & { error?: string }): ExecuteResult {
  return {
    ok: false,
    exitCode: partial.exitCode ?? 1,
    durationMs: 1,
    error: partial.error ?? '',
    ...partial,
  }
}

describe('classifyJobFailure', () => {
  test('usage limit from text', () => {
    expect(classifyJobFailure(fail({ error: 'Error: usage limit reached, try again later' }))).toBe(
      'usage_limit',
    )
    expect(classifyJobFailure(fail({ error: 'HTTP 429 Too Many Requests' }))).toBe('usage_limit')
  })

  test('network errors', () => {
    expect(classifyJobFailure(fail({ exitCode: null, error: 'ECONNRESET' }))).toBe('network')
    expect(classifyJobFailure(fail({ error: 'fetch failed: socket hang up' }))).toBe('network')
  })

  test('process crash on spawn / timeout', () => {
    expect(classifyJobFailure(fail({ exitCode: null, error: 'spawn ENOENT' }))).toBe('process_crash')
    expect(classifyJobFailure(fail({ error: 'process timed out after 60000ms' }))).toBe('process_crash')
  })

  test('verdict-fail returns null', () => {
    expect(classifyJobFailure(fail({ exitCode: 1, error: 'task failed' }))).toBe(null)
  })

  test('usage before network when both could match', () => {
    expect(
      classifyJobFailure(fail({ error: '429 rate limit — connection reset in body' })),
    ).toBe('usage_limit')
  })

  test('parseUsageResetAt', () => {
    const d = parseUsageResetAt('usage limit — resets at 2026-08-13T14:00:00.000Z')
    expect(d?.toISOString()).toBe('2026-08-13T14:00:00.000Z')
    expect(parseUsageResetAt('no reset here')).toBe(null)
  })
})
