import { describe, expect, test } from 'bun:test'
import { formatJobLogFooter, formatJobLogHeader } from '../../../../src/features/runner/business/jobLogFormat.js'

describe('jobLogFormat', () => {
  test('header includes job metadata lines', () => {
    const h = formatJobLogHeader({
      jobId: 'job-1',
      providerId: 'cursor-cli',
      taskId: 'T1',
      stepId: 'investigate',
      sessionId: 'sess-1',
      workspace: '/tmp/ws',
    })
    expect(h).toContain('jobId: job-1')
    expect(h).toContain('provider: cursor-cli')
    expect(h).toContain('taskId: T1')
    expect(h).toContain('stepId: investigate')
    expect(h).toContain('sessionId: sess-1')
  })

  test('footer includes session and tokens', () => {
    const f = formatJobLogFooter({
      ok: true,
      exitCode: 0,
      durationMs: 12,
      sessionId: 'sess-2',
      tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, estimated: true },
    })
    expect(f).toContain('sessionCaptured: sess-2')
    expect(f).toContain('tokenUsage:')
    expect(f).toContain('estimated')
  })
})
