import { describe, expect, it } from 'vitest'
import { parseJobLogSections } from '@/features/logs/scripts/logSections'

describe('parseJobLogSections', () => {
  it('splits a full CLI-provider log into labeled sections', () => {
    const text = [
      '=== Job metadata ===',
      'jobId: j1',
      '',
      '=== Payload gửi cho runner ===',
      'Agent: project/x',
      '--- Prompt ---',
      'làm việc A',
      '',
      '=== Phản hồi của runner (stdout/stderr) ===',
      '',
      'đây là **kết quả** markdown',
      '=== Kết quả ===',
      'ok: true',
    ].join('\n')

    const sections = parseJobLogSections(text)
    expect(sections.map((s) => s.kind)).toEqual(['meta', 'payload', 'meta', 'output', 'result'])
    expect(sections[0].body).toBe('jobId: j1')
    expect(sections[1].body).toContain('Agent: project/x')
    expect(sections[2].title).toBe('Prompt')
    expect(sections[2].body).toBe('làm việc A')
    expect(sections[3].body).toContain('đây là **kết quả** markdown')
    expect(sections[4].body).toBe('ok: true')
  })

  it('maps a "System prompt ..." marker to the system-prompt kind', () => {
    const text = [
      '=== Payload gửi cho runner ===',
      'Agent: x',
      '--- Prompt ---',
      'user text',
      '--- System prompt (đã gửi cho model) ---',
      'be helpful',
      '',
      '=== Phản hồi của runner ===',
      '',
      'final answer',
    ].join('\n')

    const sections = parseJobLogSections(text)
    const systemSection = sections.find((s) => s.kind === 'system-prompt')
    expect(systemSection?.body).toBe('be helpful')
  })

  it('falls back to a single output section for text with no recognizable markers (old logs / console-command)', () => {
    const text = 'hello job log\nsecond line\n'
    const sections = parseJobLogSections(text)
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('output')
    expect(sections[0].body).toBe('hello job log\nsecond line')
  })

  it('does not throw or return an empty result for an empty log', () => {
    expect(() => parseJobLogSections('')).not.toThrow()
    const sections = parseJobLogSections('')
    expect(sections.length).toBeGreaterThan(0)
  })
})
