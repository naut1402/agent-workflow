import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTask } from '../../../../src/features/monitor/business/tasks/create'
import {
  buildHeuristicTaskName,
  generateAndApplyTaskName,
} from '../../../../src/features/monitor/business/tasks/generateTaskName'

let dirs: string[] = []
async function tmpRoot(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'task-genname-'))
  dirs.push(d)
  return d
}
const originalFetch = globalThis.fetch
const savedKey = process.env.ANTHROPIC_API_KEY
afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  dirs = []
  globalThis.fetch = originalFetch
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = savedKey
})

describe('buildHeuristicTaskName', () => {
  test('takes the first non-empty line, strips a markdown heading prefix', () => {
    expect(buildHeuristicTaskName('\n\n## Fix the login bug\n\nmore detail')).toBe('Fix the login bug')
  })

  test('caps at 60 chars total (including the ellipsis) for longer input', () => {
    const long = 'x'.repeat(80)
    const name = buildHeuristicTaskName(long)
    expect(name.length).toBeLessThanOrEqual(60)
    expect(name.endsWith('…')).toBe(true)
  })
})

describe('generateAndApplyTaskName', () => {
  test('uses the LLM name when ANTHROPIC_API_KEY is set and the call succeeds', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ content: [{ text: 'Sửa lỗi đăng nhập' }] }), { status: 200 })) as unknown as typeof fetch

    const root = await tmpRoot()
    const created = await createTask(root, {
      taskId: 'F0030',
      source: 'prompt',
      prompt: 'Login is broken for some users',
      knowledgeInputs: [],
      autoReview: false,
      exportJson: false,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    await generateAndApplyTaskName(root, 'F0030', 'Login is broken for some users', created.mtime)

    const state = JSON.parse(await fs.readFile(created.stateFile, 'utf8'))
    expect(state.name).toBe('Sửa lỗi đăng nhập')
  })

  test('falls back to the heuristic name when the LLM call fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const root = await tmpRoot()
    const created = await createTask(root, {
      taskId: 'F0031',
      source: 'prompt',
      prompt: 'Fix the checkout flow',
      knowledgeInputs: [],
      autoReview: false,
      exportJson: false,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    await generateAndApplyTaskName(root, 'F0031', 'Fix the checkout flow', created.mtime)

    const state = JSON.parse(await fs.readFile(created.stateFile, 'utf8'))
    expect(state.name).toBe('Fix the checkout flow')
  })

  test('swallows a mtime conflict (user already renamed) without overwriting', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const root = await tmpRoot()
    const created = await createTask(root, {
      taskId: 'F0032',
      source: 'prompt',
      prompt: 'Fix the checkout flow',
      knowledgeInputs: [],
      autoReview: false,
      exportJson: false,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // Simulate the user having already renamed the task (state changed since
    // it was scaffolded) by passing a stale expected mtime — the write must
    // be skipped rather than clobbering whatever is on disk now.
    await generateAndApplyTaskName(root, 'F0032', 'Fix the checkout flow', created.mtime - 1)

    const state = JSON.parse(await fs.readFile(created.stateFile, 'utf8'))
    expect(state.name).toBeUndefined()
  })
})
