import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readApiAgentTranscript } from '../../../../../src/features/monitor/business/apiAgentTranscript.js'
import { appendTranscriptTurn } from '../../../../../src/features/runner/business/providers/agentTranscriptStore.js'

let home: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-api-agent-transcript-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

describe('readApiAgentTranscript', () => {
  test('parses turns written by agentTranscriptStore.appendTranscriptTurn', () => {
    appendTranscriptTurn('openai-api', 'sess-read-1', { role: 'user', text: 'hi' })
    appendTranscriptTurn('openai-api', 'sess-read-1', { role: 'tool', tool: 'read_file', text: '{"path":"a.md"}' })
    appendTranscriptTurn('openai-api', 'sess-read-1', { role: 'assistant', text: 'done' })

    const { turns, total, file } = readApiAgentTranscript('openai-api', 'sess-read-1')
    expect(file).toBeTruthy()
    expect(total).toBe(3)
    expect(turns.map((t) => t.role)).toEqual(['user', 'tool', 'assistant'])
    expect(turns[1]?.tool).toBe('read_file')
  })

  test('missing session file → empty turns, file: null, never throws', () => {
    const result = readApiAgentTranscript('anthropic-api', 'no-such-session')
    expect(result).toEqual({ turns: [], total: 0, file: null })
  })

  test('a half-written trailing JSON line is skipped, not thrown on', () => {
    appendTranscriptTurn('anthropic-api', 'sess-read-2', { role: 'user', text: 'hello' })
    const file = path.join(home, 'agent-sdk-transcripts', 'anthropic-api', 'sess-read-2.jsonl')
    fs.appendFileSync(file, '{"role":"assistant","tex')
    const { turns, total } = readApiAgentTranscript('anthropic-api', 'sess-read-2')
    expect(total).toBe(1)
    expect(turns[0]?.text).toBe('hello')
  })

  test('includeToolActivity: false drops role:"tool" turns', () => {
    appendTranscriptTurn('gemini-api', 'sess-read-3', { role: 'user', text: 'q' })
    appendTranscriptTurn('gemini-api', 'sess-read-3', { role: 'tool', tool: 'list_directory', text: '{}' })
    appendTranscriptTurn('gemini-api', 'sess-read-3', { role: 'assistant', text: 'a' })

    const { turns } = readApiAgentTranscript('gemini-api', 'sess-read-3', { includeToolActivity: false })
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant'])
  })

  test('fromIndex only returns turns at/after that index, but total counts everything', () => {
    appendTranscriptTurn('xai-api', 'sess-read-4', { role: 'user', text: 'one' })
    appendTranscriptTurn('xai-api', 'sess-read-4', { role: 'assistant', text: 'two' })
    appendTranscriptTurn('xai-api', 'sess-read-4', { role: 'assistant', text: 'three' })

    const { turns, total } = readApiAgentTranscript('xai-api', 'sess-read-4', { fromIndex: 1 })
    expect(total).toBe(3)
    expect(turns.map((t) => t.text)).toEqual(['two', 'three'])
  })
})
