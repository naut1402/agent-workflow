import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendTranscriptTurn,
  loadSessionMessages,
  readTranscriptTurns,
  saveSessionMessages,
} from '../../../../../../src/features/runner/business/providers/agentTranscriptStore.js'

let home: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agent-transcript-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

describe('agentTranscriptStore', () => {
  test('appendTranscriptTurn + readTranscriptTurns round-trip in order', () => {
    appendTranscriptTurn('openai-api', 'sess-1', { role: 'user', text: 'hello' })
    appendTranscriptTurn('openai-api', 'sess-1', { role: 'tool', tool: 'write_file', text: '{"path":"a.md"}' })
    appendTranscriptTurn('openai-api', 'sess-1', { role: 'assistant', text: 'done' })

    const turns = readTranscriptTurns('openai-api', 'sess-1')
    expect(turns.map((t) => t.role)).toEqual(['user', 'tool', 'assistant'])
    expect(turns[1]?.tool).toBe('write_file')
    expect(turns.every((t) => typeof t.at === 'string')).toBe(true)
  })

  test('readTranscriptTurns returns [] for a missing session — never throws', () => {
    expect(readTranscriptTurns('openai-api', 'does-not-exist')).toEqual([])
  })

  test('readTranscriptTurns skips a half-written trailing line without dropping earlier turns', () => {
    appendTranscriptTurn('anthropic-api', 'sess-2', { role: 'user', text: 'hi' })
    const file = path.join(home, 'agent-sdk-transcripts', 'anthropic-api', 'sess-2.jsonl')
    fs.appendFileSync(file, '{"role":"assistant","tex') // truncated write mid-flight
    const turns = readTranscriptTurns('anthropic-api', 'sess-2')
    expect(turns).toHaveLength(1)
    expect(turns[0]?.text).toBe('hi')
  })

  test('different providerId namespaces the same sessionId separately', () => {
    appendTranscriptTurn('openai-api', 'sess-shared', { role: 'user', text: 'from openai' })
    appendTranscriptTurn('gemini-api', 'sess-shared', { role: 'user', text: 'from gemini' })
    expect(readTranscriptTurns('openai-api', 'sess-shared')[0]?.text).toBe('from openai')
    expect(readTranscriptTurns('gemini-api', 'sess-shared')[0]?.text).toBe('from gemini')
  })

  test('saveSessionMessages + loadSessionMessages round-trip opaque payloads', () => {
    const messages = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'text', text: 'yo' }] }]
    saveSessionMessages('sess-msgs', messages)
    expect(loadSessionMessages('sess-msgs')).toEqual(messages)
  })

  test('loadSessionMessages returns [] for a missing/corrupt session file', () => {
    expect(loadSessionMessages('never-saved')).toEqual([])
    const file = path.join(home, 'agent-sdk-sessions', 'corrupt.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{not json')
    expect(loadSessionMessages('corrupt')).toEqual([])
  })
})
