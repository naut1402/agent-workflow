import { describe, expect, test } from 'bun:test'
import { buildClaudeInvocation } from '../../../../src/features/runner/business/providers/claude-code-cli.js'
import {
  buildCursorJsonArgs,
  buildCursorJsonInvocation,
  mintSessionId,
  parseCursorJsonOutput,
  prepareSessionInvocation,
} from '../../../../src/features/runner/business/sessionLedger.js'

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

  test('cursor parse-json: buildCursorJsonArgs adds -p, json, sandbox disabled, force, trust (prompt NOT in argv)', () => {
    const args = buildCursorJsonArgs(['--model', 'x'], 'do task')
    expect(args).toContain('-p')
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
    expect(args).toContain('--sandbox')
    expect(args).toContain('disabled')
    expect(args).toContain('--force')
    expect(args).toContain('--trust')
    // Regression (#177): prompt must never be an argv element — Windows
    // shell:true space-joins argv and cmd.exe would truncate a multi-line
    // prompt to the first token ("##").
    expect(args).not.toContain('do task')
  })

  test('cursor parse-json: buildCursorJsonInvocation puts prompt on stdin and --resume in argv', () => {
    const inv = buildCursorJsonInvocation({
      flags: ['--model', 'x'],
      prompt: '## Agent instructions\n\nfull multi-line prompt',
      resumeSessionId: 'sess-abc',
    })
    expect(inv.stdinInput).toBe('## Agent instructions\n\nfull multi-line prompt')
    expect(inv.args).toEqual([
      '--model',
      'x',
      '-p',
      '--output-format',
      'json',
      '--sandbox',
      'disabled',
      '--force',
      '--trust',
      '--resume',
      'sess-abc',
    ])
    for (const arg of inv.args) {
      expect(arg.includes('Agent instructions')).toBe(false)
    }
  })

  test('cursor parse-json: does not duplicate --trust / --force / --sandbox when already set', () => {
    const args = buildCursorJsonArgs(['--trust', '--force', '--sandbox', 'enabled', '-p'], 'do task')
    expect(args.filter((f) => f === '--trust')).toHaveLength(1)
    expect(args.filter((f) => f === '--force')).toHaveLength(1)
    expect(args.filter((f) => f === '--sandbox')).toHaveLength(1)
    expect(args).toContain('enabled')
    expect(args).not.toContain('disabled')
  })

  test('cursor parse-json: --yolo / -f count as force (no duplicate --force)', () => {
    expect(buildCursorJsonArgs(['--yolo'], 'x')).toContain('--yolo')
    expect(buildCursorJsonArgs(['--yolo'], 'x')).not.toContain('--force')
    expect(buildCursorJsonArgs(['-f'], 'x')).toContain('-f')
    expect(buildCursorJsonArgs(['-f'], 'x')).not.toContain('--force')
    expect(buildCursorJsonArgs(['--force'], 'x').filter((f) => f === '--force')).toHaveLength(1)
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

  test('parseCursorJsonOutput tolerates leading noise before JSON object', () => {
    const body = JSON.stringify({
      session_id: 'chat-noise',
      result: '===DRAFT_READY===\n```json\n{"taskId":"t1"}\n```',
    })
    const stdout = `cursor-retrieval: tracing to 'C:\\Temp\\x.log'\n${body}\n`
    expect(parseCursorJsonOutput(stdout)).toEqual({
      session_id: 'chat-noise',
      result: '===DRAFT_READY===\n```json\n{"taskId":"t1"}\n```',
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
