import { describe, expect, test } from 'bun:test'
import { parseBuilderOutput } from '../../../../src/features/nl-chat/business/parseBuilderOutput'

describe('parseBuilderOutput', () => {
  test('sentinel + valid JSON → draft', () => {
    const stdout = '===DRAFT_READY===\n```json\n{"taskId": "t1", "prompt": "do it"}\n```\n'
    const turn = parseBuilderOutput(stdout)
    expect(turn).toEqual({ kind: 'draft', draft: { taskId: 't1', prompt: 'do it' } })
  })

  test('sentinel + malformed JSON → falls back to a question (no throw)', () => {
    const stdout = '===DRAFT_READY===\n```json\n{ not json\n```\n'
    const turn = parseBuilderOutput(stdout)
    expect(turn.kind).toBe('question')
    if (turn.kind === 'question') expect(turn.text).toBe('Draft sinh lỗi, vui lòng thử lại.')
  })

  test('sentinel with no JSON object at all → falls back to a question', () => {
    const stdout = '===DRAFT_READY===\nkhông có json ở đây'
    const turn = parseBuilderOutput(stdout)
    expect(turn.kind).toBe('question')
  })

  test('no sentinel → plain question text', () => {
    const stdout = '  Bạn muốn đặt tên task là gì?  '
    const turn = parseBuilderOutput(stdout)
    expect(turn).toEqual({ kind: 'question', text: 'Bạn muốn đặt tên task là gì?' })
  })

  test('JSON has extra fields outside schema → still parsed (schema enforcement is the caller/UI concern)', () => {
    const stdout = '===DRAFT_READY===\n```json\n{"taskId": "t1", "prompt": "p", "extra": true}\n```'
    const turn = parseBuilderOutput(stdout)
    expect(turn).toEqual({ kind: 'draft', draft: { taskId: 't1', prompt: 'p', extra: true } })
  })

  test('auto mode: { entityType, draft } wrapper → draft carries the inferred entity type', () => {
    const stdout = '===DRAFT_READY===\n```json\n{"entityType": "pipeline", "draft": {"steps": [{"agent": "a"}]}}\n```'
    const turn = parseBuilderOutput(stdout)
    expect(turn).toEqual({ kind: 'draft', entityType: 'pipeline', draft: { steps: [{ agent: 'a' }] } })
  })

  test('wrapper with an unknown entityType is treated as a bare draft, not unwrapped', () => {
    const stdout = '===DRAFT_READY===\n```json\n{"entityType": "widget", "draft": {"a": 1}}\n```'
    const turn = parseBuilderOutput(stdout)
    expect(turn).toEqual({ kind: 'draft', draft: { entityType: 'widget', draft: { a: 1 } } })
  })

  test('empty stdout → empty question text, not a throw', () => {
    const turn = parseBuilderOutput('')
    expect(turn).toEqual({ kind: 'question', text: '' })
  })
})
