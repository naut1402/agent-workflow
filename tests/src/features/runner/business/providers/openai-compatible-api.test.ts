import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OpenAiCompatibleProvider } from '../../../../../../src/features/runner/business/providers/openai-compatible-api.js'
import { readTranscriptTurns } from '../../../../../../src/features/runner/business/providers/agentTranscriptStore.js'
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

  test('reasoning text alongside a tool call is written to the transcript live, not dropped', async () => {
    let call = 0
    globalThis.fetch = (async () => {
      call++
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            {
              role: 'assistant',
              content: "I'll check the workspace first.",
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'list_directory', arguments: '{}' } },
              ],
            },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'done' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(
      { ...baseRequest(workspace), sessionId: 'reasoning-turn-session' },
      { model: 'gpt-test' },
      credential,
    )

    expect(result.ok).toBe(true)
    const turns = readTranscriptTurns('openai-api', 'reasoning-turn-session')
    // Previously only the final no-tool-call turn's text ever reached the
    // transcript — this turn's own reasoning text was silently dropped.
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(turns[1]?.text).toBe("I'll check the workspace first.")
    expect(turns[3]?.text).toBe('done')
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

  test('follow-up request after a tool call stays OpenAI-spec shaped (strict compat backends like Gemini)', async () => {
    const bodies: Array<Record<string, any>> = []
    let call = 0
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) } },
              ],
            },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'read it' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('gemini-api', 'https://generativelanguage.googleapis.com/v1beta/openai')
    const result = await provider.execute(baseRequest(workspace), { model: 'gemini-2.5-pro' }, credential)

    expect(result.ok).toBe(true)
    expect(call).toBe(2)

    const followUp = bodies[1]
    // Assistant message carries ONLY spec fields — no raw tool_call `type`/`function`
    // leaked onto the message itself (what @openai/agents' converter used to emit
    // and Gemini's endpoint rejects).
    const assistant = followUp.messages.find((m: Record<string, any>) => m.role === 'assistant')
    expect(assistant).toBeDefined()
    expect(Object.keys(assistant).sort()).toEqual(['content', 'role', 'tool_calls'])
    expect(assistant.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) } },
    ])
    const toolMessage = followUp.messages.find((m: Record<string, any>) => m.role === 'tool')
    expect(toolMessage.tool_call_id).toBe('call_1')
    // No OpenAI-only `strict` flag on tool definitions.
    for (const t of followUp.tools) {
      expect('strict' in t.function).toBe(false)
    }
  })

  test('empty model fails fast with a clear error instead of a provider 404', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'x' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('gemini-api', 'https://generativelanguage.googleapis.com/v1beta/openai')
    const result = await provider.execute(baseRequest(workspace), {}, credential)

    expect(result.ok).toBe(false)
    expect(called).toBe(false)
    if (!result.ok) expect(result.error).toContain('model is required')
  })

  test('a 200 OK response carrying an error field (no choices) fails with a clear message instead of crashing', async () => {
    globalThis.fetch = (async () => jsonResponse({ id: 'c1', error: { message: 'Provider returned error', code: 429 } })) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(workspace), { model: 'gpt-test' }, credential)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Provider returned error')
  })

  test('a response with an empty choices array fails with a clear message', async () => {
    globalThis.fetch = (async () => jsonResponse({ id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-test', choices: [] })) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(workspace), { model: 'gpt-test' }, credential)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('không có choices')
  })

  test('listModels() calls the SDK models endpoint and returns sorted ids', async () => {
    let seenUrl = ''
    globalThis.fetch = (async (url: string) => {
      seenUrl = String(url)
      return jsonResponse({ object: 'list', data: [{ id: 'gpt-4o', object: 'model' }, { id: 'gpt-4.1', object: 'model' }] })
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const models = await provider.listModels('sk-openai-test', '')

    expect(seenUrl).toBe('https://api.openai.test/v1/models')
    expect(models).toEqual(['gpt-4.1', 'gpt-4o'])
  })

  test('listModels() respects an explicit baseURL override', async () => {
    let seenUrl = ''
    globalThis.fetch = (async (url: string) => {
      seenUrl = String(url)
      return jsonResponse({ object: 'list', data: [] })
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('gemini-api', 'https://default.example/v1')
    await provider.listModels('key', 'https://custom-gateway.example/v1')

    expect(seenUrl).toBe('https://custom-gateway.example/v1/models')
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
