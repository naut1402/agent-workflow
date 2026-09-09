import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  encodeWorkspacePath,
  findTranscriptFile,
  readTranscript,
  readSessionTranscript,
} from '../../../../src/features/monitor/business/sessionTranscript'

// The CLI keeps its own conversation transcript at
// <CLAUDE_CONFIG_DIR>/projects/<encoded cwd>/<sessionId>.jsonl and appends to it
// while the job runs — that file is what the dashboard chat replays.

const SESSION = '62e090eb-3565-463c-8ead-748779ec7703'
const WORKSPACE = path.join('C:', 'Users', 'demo', '.dev-team-dashboard', 'tasks', 'DEMO-1')

let configDir: string
let transcriptFile: string
const savedEnv = process.env.CLAUDE_CONFIG_DIR

function line(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`
}

beforeAll(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-claude-cfg-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  const dir = path.join(configDir, 'projects', encodeWorkspacePath(WORKSPACE))
  fs.mkdirSync(dir, { recursive: true })
  transcriptFile = path.join(dir, `${SESSION}.jsonl`)
  fs.writeFileSync(
    transcriptFile,
    [
      line({ type: 'queue-operation', operation: 'enqueue' }),
      line({ type: 'user', message: { role: 'user', content: 'chạy step design đi' }, timestamp: '2026-01-01T00:00:00Z' }),
      line({ type: 'attachment', attachment: {} }),
      line({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'nội bộ, không phải hội thoại' },
            { type: 'text', text: 'Mình đọc design.md trước.' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'docs/design.md' } },
          ],
        },
        timestamp: '2026-01-01T00:00:05Z',
      }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'file body' }] } }),
      line({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'subagent nói gì đó' }] } }),
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Xong rồi nhé.' }] } }),
      '{ dòng chưa ghi xong', // the CLI is still streaming
    ].join(''),
    'utf8',
  )
})

afterAll(() => {
  if (savedEnv == null) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedEnv
  fs.rmSync(configDir, { recursive: true, force: true })
})

describe('encodeWorkspacePath', () => {
  test('replaces every non-alphanumeric char, matching the CLI layout', () => {
    expect(encodeWorkspacePath('C:\\Users\\me\\.dev-team-dashboard\\x')).toBe('C--Users-me--dev-team-dashboard-x')
  })
})

describe('findTranscriptFile', () => {
  test('finds the file via the encoded workspace path', () => {
    expect(findTranscriptFile(SESSION, WORKSPACE)).toBe(transcriptFile)
  })

  test('falls back to scanning when the workspace is unknown or differs', () => {
    expect(findTranscriptFile(SESSION)).toBe(transcriptFile)
    expect(findTranscriptFile(SESSION, path.join('D:', 'somewhere', 'else'))).toBe(transcriptFile)
  })

  test('unknown session → null; a path-traversal id is rejected outright', () => {
    expect(findTranscriptFile('11111111-2222-3333-4444-555555555555')).toBeNull()
    expect(findTranscriptFile('../../etc/passwd')).toBeNull()
  })
})

describe('readTranscript', () => {
  test('keeps user/assistant text, drops CLI bookkeeping, thinking and tool_result', () => {
    const { turns } = readTranscript(transcriptFile, { includeToolActivity: false })
    expect(turns.map((t) => `${t.role}:${t.text}`)).toEqual([
      'user:chạy step design đi',
      'assistant:Mình đọc design.md trước.',
      'assistant:Xong rồi nhé.',
    ])
  })

  test('tool_use becomes an activity turn — the live "agent đang làm gì" signal', () => {
    const { turns } = readTranscript(transcriptFile)
    const tool = turns.find((t) => t.role === 'tool')
    expect(tool).toMatchObject({ tool: 'Read', text: 'docs/design.md' })
  })

  test('skips sidechain (subagent) entries', () => {
    const { turns } = readTranscript(transcriptFile)
    expect(turns.some((t) => t.text.includes('subagent'))).toBe(false)
  })

  test('a half-written trailing line does not throw', () => {
    expect(() => readTranscript(transcriptFile)).not.toThrow()
  })

  test('fromIndex acts as a poll cursor and total is the next cursor', () => {
    const all = readTranscript(transcriptFile)
    const tail = readTranscript(transcriptFile, { fromIndex: all.total - 1 })
    expect(tail.turns).toHaveLength(1)
    expect(tail.turns[0]).toEqual(all.turns[all.total - 1])
    expect(readTranscript(transcriptFile, { fromIndex: all.total }).turns).toEqual([])
  })

  test('missing file → empty result, not a throw', () => {
    expect(readTranscript(path.join(configDir, 'nope.jsonl'))).toEqual({ turns: [], total: 0 })
    expect(readSessionTranscript('does-not-exist')).toMatchObject({ turns: [], total: 0, file: null })
  })
})
