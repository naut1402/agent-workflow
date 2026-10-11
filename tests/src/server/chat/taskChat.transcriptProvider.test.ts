import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getTaskChatState } from '../../../../src/features/monitor/business/taskChat'
import { saveTaskSessionLedger, type SessionEntry } from '../../../../src/features/runner/business/sessionLedger'

// Characterization (#441 · Tfb77cf90-P2): which transcript reader getTaskChatState
// picks for a provider id, the `transcriptProvider` label it reports, and the
// message shown when no transcript is on disk. Only ledger entries are written
// (no job) so the job-stdout fallback never kicks in and the reader result is
// what the API returns.

const PROJECT = 'P-chat-provider'
const TASK = 'DEMO-PROVIDER'
const WORKSPACE = path.join('C:', 'work', 'tasks', 'DEMO-PROVIDER')

const CURSOR_MISSING =
  'Không tìm thấy transcript Cursor cho session này (kiểm tra ~/.cursor/projects/*/agent-transcripts). Có thể CLI chưa ghi file hoặc session_id chưa capture.'
const GENERIC_MISSING =
  'Không tìm thấy transcript trên disk cho session id này. Session có thể thuộc provider khác hoặc cwd không khớp.'

let home: string
let claudeDir: string
let cursorDir: string
const savedEnv = { ...process.env }

function useLedger(providerId: string, sessionId: string): void {
  const entry: SessionEntry = {
    providerId,
    runnerId: 'r1',
    connectionId: 'c1',
    workspace: WORKSPACE,
    host: os.hostname(),
    stepIds: [],
    status: 'open',
    sessionId,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
  }
  saveTaskSessionLedger(PROJECT, { version: 1, taskId: TASK, sessionPolicy: 'single', sessions: [entry] })
}

function writeCursorTranscript(sessionId: string, lines: object[]): void {
  const dir = path.join(cursorDir, 'projects', 'proj-x', 'agent-transcripts')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'), 'utf8')
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-chat-provider-home-'))
  claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-chat-provider-claude-'))
  cursorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-chat-provider-cursor-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.CLAUDE_CONFIG_DIR = claudeDir
  process.env.CURSOR_CONFIG_DIR = cursorDir
})

afterEach(() => {
  fs.rmSync(path.join(home, 'sessions'), { recursive: true, force: true })
  fs.rmSync(path.join(cursorDir, 'projects'), { recursive: true, force: true })
})

afterAll(() => {
  process.env = savedEnv
  for (const dir of [home, claudeDir, cursorDir]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('getTaskChatState — transcript reader selection (characterization)', () => {
  test('cursor-cli with no file on disk → Cursor-specific missing reason', () => {
    useLedger('cursor-cli', 's-cursor-missing')
    const state = getTaskChatState(PROJECT, TASK)
    expect(state.sessionId).toBe('s-cursor-missing')
    expect(state.transcriptFound).toBe(false)
    expect(state.transcriptProvider).toBe('cursor-cli')
    expect(state.transcriptMissingReason).toBe(CURSOR_MISSING)
  })

  test('claude-code-cli with no file on disk → generic missing reason', () => {
    useLedger('claude-code-cli', 's-claude-missing')
    const state = getTaskChatState(PROJECT, TASK)
    expect(state.transcriptFound).toBe(false)
    expect(state.transcriptProvider).toBe('claude-code-cli')
    expect(state.transcriptMissingReason).toBe(GENERIC_MISSING)
  })

  test('ai-api provider with no file on disk → generic missing reason, label is the provider id', () => {
    useLedger('openai-api', 's-openai-missing')
    const state = getTaskChatState(PROJECT, TASK)
    expect(state.transcriptFound).toBe(false)
    expect(state.transcriptProvider).toBe('openai-api')
    expect(state.transcriptMissingReason).toBe(GENERIC_MISSING)
  })

  test("codex-cli → label 'unknown', generic missing reason", () => {
    useLedger('codex-cli', 's-codex-missing')
    const state = getTaskChatState(PROJECT, TASK)
    expect(state.transcriptFound).toBe(false)
    expect(state.transcriptProvider).toBe('unknown')
    expect(state.transcriptMissingReason).toBe(GENERIC_MISSING)
  })

  test("empty provider id → label 'claude-code-cli'", () => {
    useLedger('', 's-empty-provider')
    const state = getTaskChatState(PROJECT, TASK)
    expect(state.transcriptProvider).toBe('claude-code-cli')
    expect(state.transcriptMissingReason).toBe(GENERIC_MISSING)
  })

  test("unknown provider id with only a Cursor file on disk → falls back to Cursor, label 'cursor-cli'", () => {
    useLedger('some-other-cli', 's-only-cursor')
    writeCursorTranscript('s-only-cursor', [
      { role: 'user', text: 'system prompt' },
      { role: 'assistant', text: 'từ cursor' },
    ])
    const state = getTaskChatState(PROJECT, TASK)
    expect(state.transcriptFound).toBe(true)
    expect(state.transcriptProvider).toBe('cursor-cli')
    expect(state.transcriptMissingReason).toBeUndefined()
    expect(state.turns.map((t) => t.text)).toEqual(['từ cursor'])
  })

  test('Cursor reader ignores includeToolActivity — tool_use blocks never become turns', () => {
    useLedger('cursor-cli', 's-cursor-tools')
    writeCursorTranscript('s-cursor-tools', [
      { type: 'user', message: { content: 'system prompt' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'đang đọc file' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'a.md' } },
          ],
        },
      },
    ])
    const withTools = getTaskChatState(PROJECT, TASK, { includeToolActivity: true })
    const withoutTools = getTaskChatState(PROJECT, TASK, { includeToolActivity: false })
    expect(withTools.transcriptProvider).toBe('cursor-cli')
    expect(withTools.turns.map((t) => `${t.role}:${t.text}`)).toEqual(['assistant:đang đọc file'])
    expect(withoutTools.turns).toEqual(withTools.turns)
    expect(withoutTools.total).toBe(withTools.total)
  })
})
