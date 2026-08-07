import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeTextFileSync, joinPath } from '../../../../../src/core/lib/fileHelper.js'
import os from 'node:os'
import {
  findCursorTranscriptFile,
  readCursorTranscript,
} from '../../../../../src/features/monitor/business/cursorSessionTranscript.js'

describe('cursorSessionTranscript', () => {
  test('finds and parses cursor agent-transcripts jsonl', () => {
    const root = joinPath(os.tmpdir(), `cursor-tx-${Date.now()}`)
    const sessionId = 'sess-cursor-abc123'
    const dir = joinPath(root, 'projects', 'proj-x', 'agent-transcripts')
    mkdirSync(dir, { recursive: true })
    const file = joinPath(dir, `${sessionId}.jsonl`)
    writeTextFileSync(
      file,
      [
        JSON.stringify({ role: 'user', text: 'hello cursor', timestamp: '2026-01-01T00:00:00Z' }),
        JSON.stringify({ role: 'assistant', text: 'hi there', timestamp: '2026-01-01T00:00:01Z' }),
      ].join('\n'),
    )

    const prev = process.env.CURSOR_CONFIG_DIR
    process.env.CURSOR_CONFIG_DIR = root
    try {
      const found = findCursorTranscriptFile(sessionId)
      expect(found).toBe(file)
      const { turns, total } = readCursorTranscript(file)
      expect(total).toBe(2)
      expect(turns[0]?.role).toBe('user')
      expect(turns[0]?.text).toContain('hello cursor')
      expect(turns[1]?.role).toBe('assistant')
    } finally {
      if (prev === undefined) delete process.env.CURSOR_CONFIG_DIR
      else process.env.CURSOR_CONFIG_DIR = prev
    }
  })
})
