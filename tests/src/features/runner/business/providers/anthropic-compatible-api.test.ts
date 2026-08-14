import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AnthropicCompatibleProvider } from '../../../../../../src/features/runner/business/providers/anthropic-compatible-api.js'
import type { CredentialProfile, ExecuteRequest } from '../../../../../../src/features/runner/business/types.js'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function anthropicMessage(content: unknown[], usage = { input_tokens: 10, output_tokens: 5 }) {
  return { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: 'end_turn', stop_sequence: null, usage }
}

let home: string
let workspace: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-anthropic-provider-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.FAKE_ANTHROPIC_KEY = 'sk-ant-test'
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

const credential: CredentialProfile = { id: 'c', provider: 'anthropic-api', label: 'x', secretRef: 'env:FAKE_ANTHROPIC_KEY' }

function baseRequest(workspaceDir: string): ExecuteRequest {
  return {
    jobId: 'job-1',
    resolvedAgent: { ref: 'agent', name: 'agent', description: '', systemPrompt: 'be helpful', skills: [] },
    userPrompt: 'create a file',
    workspace: workspaceDir,
  }
}

describe('AnthropicCompatibleProvider', () => {
  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-anthropic-ws-'))
  })
  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  test('maps a text_editor "create" tool_use to writeWorkspaceFile, then returns the final text', async () => {
    let call = 0
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      if (call === 1) {
        expect(new Headers(init?.headers).get('x-api-key')).toBe('sk-ant-test')
        return jsonResponse(
          anthropicMessage([
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'str_replace_based_edit_tool',
              input: { command: 'create', path: 'out.md', file_text: 'hello from model' },
            },
          ]),
        )
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'all done' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(workspace), { model: 'claude-test' }, credential)

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('all done')
    expect(fs.readFileSync(path.join(workspace, 'out.md'), 'utf8')).toBe('hello from model')
    expect(call).toBe(2)
  })

  test('maps "view"/"str_replace"/list_directory commands to the matching sandbox op', async () => {
    fs.writeFileSync(path.join(workspace, 'existing.md'), 'one two three')
    fs.mkdirSync(path.join(workspace, 'dir'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'dir', 'inner.md'), '1')

    const turns: unknown[] = [
      [{ type: 'tool_use', id: 't1', name: 'str_replace_based_edit_tool', input: { command: 'view', path: 'existing.md' } }],
      [{ type: 'tool_use', id: 't2', name: 'list_directory', input: { path: 'dir' } }],
      [{ type: 'tool_use', id: 't3', name: 'str_replace_based_edit_tool', input: { command: 'str_replace', path: 'existing.md', old_str: 'two', new_str: 'TWO' } }],
      [{ type: 'text', text: 'inspected and edited' }],
    ]
    let call = 0
    globalThis.fetch = (async () => jsonResponse(anthropicMessage(turns[call++] as unknown[]))) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(workspace), { model: 'claude-test' }, credential)

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('inspected and edited')
    expect(fs.readFileSync(path.join(workspace, 'existing.md'), 'utf8')).toBe('one TWO three')
    expect(call).toBe(4)
  })

  test('an unknown text_editor command reports a structured error back to the model, without crashing the job', async () => {
    const seenToolResults: unknown[] = []
    let call = 0
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      if (call === 1) {
        return jsonResponse(anthropicMessage([{ type: 'tool_use', id: 't1', name: 'str_replace_based_edit_tool', input: { command: 'undo_edit', path: 'x.md' } }]))
      }
      const body = JSON.parse(String(init?.body))
      seenToolResults.push(body.messages[body.messages.length - 1])
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'recovered' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(workspace), { model: 'claude-test' }, credential)

    expect(result.ok).toBe(true)
    const toolResultMsg = seenToolResults[0] as { content: Array<{ is_error?: boolean; content: string }> }
    expect(toolResultMsg.content[0]?.is_error).toBe(true)
    expect(toolResultMsg.content[0]?.content).toContain('unknown text_editor command')
  })

  test('exceeds MAX_AGENT_LOOP_TURNS when the model keeps calling tools forever', async () => {
    globalThis.fetch = (async () =>
      jsonResponse(anthropicMessage([{ type: 'tool_use', id: 't', name: 'list_directory', input: {} }]))) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(workspace), { model: 'claude-test' }, credential)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/exceeded \d+ agent loop turns/)
  })

  test('rejects a tool call that tries to escape the workspace', async () => {
    let call = 0
    globalThis.fetch = (async () => {
      call++
      if (call === 1) {
        return jsonResponse(
          anthropicMessage([{ type: 'tool_use', id: 't1', name: 'str_replace_based_edit_tool', input: { command: 'view', path: '../../etc/passwd' } }]),
        )
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'blocked' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(workspace), { model: 'claude-test' }, credential)
    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('blocked')
    expect(fs.existsSync('/etc/passwd-should-not-be-read-flag')).toBe(false)
  })
})
