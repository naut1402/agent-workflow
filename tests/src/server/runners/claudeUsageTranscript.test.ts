import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  encodeCwdForClaudeProjects,
  listNewSubagentFiles,
  readNewUsage,
} from '../../../../src/features/runner/business/claudeUsageTranscript.js'

describe('encodeCwdForClaudeProjects', () => {
  test('matches verified Claude projects encoding', () => {
    expect(encodeCwdForClaudeProjects('/data/project/agent-workflow')).toBe(
      '-data-project-agent-workflow',
    )
    expect(
      encodeCwdForClaudeProjects('/data/project/agent-workflow/.dev-team-agent/tasks/Tb79e7eca'),
    ).toBe('-data-project-agent-workflow--dev-team-agent-tasks-Tb79e7eca')
  })
})

describe('readNewUsage', () => {
  let dir: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-'))
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('dedupes same message.id across assistant lines', async () => {
    const file = path.join(dir, 'dedupe.jsonl')
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    }
    const rows = [0, 1, 2].map((i) =>
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg-1',
          model: 'claude-sonnet',
          usage,
          content: [{ type: i === 0 ? 'thinking' : 'tool_use' }],
        },
      }),
    )
    fs.writeFileSync(file, rows.join('\n') + '\n')
    const r = await readNewUsage(file, 0)
    expect(r).not.toBeNull()
    expect(r!.usage.inputTokens).toBe(100)
    expect(r!.usage.outputTokens).toBe(50)
    expect(r!.usage.cacheReadTokens).toBe(10)
    expect(r!.usage.cacheWriteTokens).toBe(5)
    expect(r!.model).toBe('claude-sonnet')
  })

  test('fromLine skips earlier rows', async () => {
    const file = path.join(dir, 'cursor.jsonl')
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'a',
          model: 'm1',
          usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'b',
          model: 'm2',
          usage: { input_tokens: 20, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    ]
    fs.writeFileSync(file, lines.join('\n') + '\n')
    const r = await readNewUsage(file, 1)
    expect(r!.usage.inputTokens).toBe(20)
    expect(r!.model).toBe('m2')
  })

  test('missing file → null', async () => {
    expect(await readNewUsage(path.join(dir, 'nope.jsonl'), 0)).toBeNull()
  })

  test('skips corrupt JSON lines', async () => {
    const file = path.join(dir, 'corrupt.jsonl')
    fs.writeFileSync(
      file,
      [
        'not-json',
        JSON.stringify({
          type: 'assistant',
          message: {
            id: 'ok',
            model: 'm',
            usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        }),
      ].join('\n') + '\n',
    )
    const r = await readNewUsage(file, 0)
    expect(r!.usage.inputTokens).toBe(3)
    expect(r!.usage.outputTokens).toBe(4)
  })
})

describe('listNewSubagentFiles', () => {
  test('filters already processed and non-matching names', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-'))
    try {
      fs.writeFileSync(path.join(dir, 'agent-old.jsonl'), '')
      fs.writeFileSync(path.join(dir, 'agent-new.jsonl'), '')
      fs.writeFileSync(path.join(dir, 'other.jsonl'), '')
      const names = await listNewSubagentFiles(dir, ['agent-old.jsonl'])
      expect(names).toEqual(['agent-new.jsonl'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
