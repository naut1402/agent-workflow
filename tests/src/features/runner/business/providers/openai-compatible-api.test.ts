import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OpenAiCompatibleProvider } from '../../../../../../src/features/runner/business/providers/openai-compatible-api.js'
import type { CredentialProfile, ExecuteRequest } from '../../../../../../src/features/runner/business/types.js'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function chatCompletion(message: Record<string, unknown>, finishReason: string, usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) {
  return {
    id: 'c1',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-test',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  }
}

let home: string
let workspace: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-openai-provider-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.FAKE_OPENAI_KEY = 'sk-openai-test'
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

const credential: CredentialProfile = { id: 'c', provider: 'openai-api', label: 'x', secretRef: 'env:FAKE_OPENAI_KEY' }

function baseRequest(workspaceDir: string): ExecuteRequest {
  return {
    jobId: 'job-1',
    resolvedAgent: { ref: 'agent', name: 'agent', description: '', systemPrompt: 'be helpful', skills: [] },
    userPrompt: 'write a file',
    workspace: workspaceDir,
  }
}

describe('OpenAiCompatibleProvider', () => {
  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-openai-ws-'))
  })
  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  test('a write_file tool call reaches writeWorkspaceFile, then the final message becomes stdout', async () => {
    let call = 0
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      call++
      if (call === 1) {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-openai-test')
        expect(String(url)).toBe('https://api.openai.test/v1/chat/completions')
        return jsonResponse(
          chatCompletion(
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'out.md', content: 'hi from gpt' }) } },
              ],
            },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'all done' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(workspace), { model: 'gpt-test' }, credential)

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('all done')
    expect(result.tokenUsage).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 })
    expect(fs.readFileSync(path.join(workspace, 'out.md'), 'utf8')).toBe('hi from gpt')
    expect(call).toBe(2)
  })

  test('a tool call path outside the workspace is rejected by the shared sandbox, not written', async () => {
    let call = 0
    globalThis.fetch = (async () => {
      call++
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: '../escape.md', content: 'nope' }) } },
              ],
            },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'blocked' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(workspace), { model: 'gpt-test' }, credential)

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('blocked')
    expect(fs.existsSync(path.join(path.dirname(workspace), 'escape.md'))).toBe(false)
  })

  test('respects an explicit runnerConfig.baseURL override', async () => {
    let seenUrl = ''
    globalThis.fetch = (async (url: string) => {
      seenUrl = String(url)
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'ok' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://default.example/v1')
    await provider.execute(baseRequest(workspace), { model: 'gpt-test', baseURL: 'https://custom-gateway.example/v1' }, credential)

    expect(seenUrl).toBe('https://custom-gateway.example/v1/chat/completions')
  })

  test('missing API key fails without making any request', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'x' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const badCredential: CredentialProfile = { id: 'c2', provider: 'openai-api', label: 'x', secretRef: 'cli-session' }
    const result = await provider.execute(baseRequest(workspace), { model: 'gpt-test' }, badCredential)

    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })
})
