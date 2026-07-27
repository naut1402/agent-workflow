import { describe, expect, test } from 'bun:test'
import { buildClaudeInvocation } from '../../../server/runners/providers/claude-code-cli.js'
import {
  buildCursorJsonArgs,
  mintSessionId,
  parseCursorJsonOutput,
  prepareSessionInvocation,
} from '../../../server/runners/sessionCapture.js'

describe('sessionCapture', () => {
  test('claude preset-uuid: mints id when starting fresh', () => {
    const plan = prepareSessionInvocation({ capture: 'preset-uuid' })
    expect(plan.sessionId).toBeTruthy()
    expect(plan.presetSessionId).toBe(plan.sessionId)
    expect(plan.resumeSessionId).toBeUndefined()

    const inv = buildClaudeInvocation({
      flags: [],
      prompt: 'hello',
      sessionId: plan.sessionId,
    })
    expect(inv.args).toContain('--session-id')
    expect(inv.args).toContain(plan.sessionId)
  })

  test('claude preset-uuid: uses provided sessionId for approval thread', () => {
    const fixed = mintSessionId()
    const plan = prepareSessionInvocation({ capture: 'preset-uuid', sessionId: fixed })
    expect(plan.sessionId).toBe(fixed)
    expect(plan.presetSessionId).toBe(fixed)
  })

  test('claude resume passes --resume only', () => {
    const plan = prepareSessionInvocation({
      capture: 'preset-uuid',
      resumeSessionId: 'resume-abc',
    })
    expect(plan.resumeSessionId).toBe('resume-abc')
    expect(plan.sessionId).toBeUndefined()

    const inv = buildClaudeInvocation({
      flags: [],
      prompt: 'follow up',
      resumeSessionId: plan.resumeSessionId,
    })
    expect(inv.args).toEqual(['-p', '--resume', 'resume-abc'])
  })

  test('cursor parse-json: buildCursorJsonArgs adds -p and --output-format json', () => {
    const args = buildCursorJsonArgs(['--model', 'x'], 'do task')
    expect(args).toContain('-p')
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
    expect(args[args.length - 1]).toBe('do task')
  })

  test('parseCursorJsonOutput extracts session_id and result', () => {
    const stdout = JSON.stringify({
      session_id: 'chat-99',
      result: 'proposed markdown body',
      other: true,
    })
    expect(parseCursorJsonOutput(stdout)).toEqual({
      session_id: 'chat-99',
      result: 'proposed markdown body',
    })
  })

  test('parseCursorJsonOutput tolerates invalid JSON', () => {
    expect(parseCursorJsonOutput('not json')).toEqual({})
    expect(parseCursorJsonOutput('')).toEqual({})
  })

  test('none capture passes session fields through unchanged', () => {
    expect(
      prepareSessionInvocation({
        capture: 'none',
        sessionId: 'a',
        resumeSessionId: 'b',
      }),
    ).toEqual({ sessionId: 'a', resumeSessionId: 'b' })
  })
})
