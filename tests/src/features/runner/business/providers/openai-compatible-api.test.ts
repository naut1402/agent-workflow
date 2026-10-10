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

  test('an upstream response that is not valid JSON is wrapped into a clear error, not a raw SyntaxError (TC-07, Lỗi 3)', async () => {
    globalThis.fetch = (async () =>
      new Response('not valid json {{{', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(workspace), { model: 'gpt-test' }, credential)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('response upstream không hợp lệ')
  })

  test('a call that hangs past the configured timeout fails within that timeout instead of hanging indefinitely (TC-06, Lỗi 3)', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      })) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const started = Date.now()
    const result = await provider.execute(baseRequest(workspace), { model: 'gpt-test', timeoutMs: 50 }, credential)
    const elapsedMs = Date.now() - started

    expect(result.ok).toBe(false)
    expect(elapsedMs).toBeLessThan(5_000)
    if (!result.ok) expect(result.error).toMatch(/timeout/)
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

describe('OpenAiCompatibleProvider — empty-reply nudge-once (silent-success bug fix)', () => {
  let ws: string
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-openai-nudge-ws-'))
  })
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true })
  })

  test('an empty reply with no tool call gets nudged once, then recovers on the next turn', async () => {
    let call = 0
    const bodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) return jsonResponse(chatCompletion({ role: 'assistant', content: '' }, 'stop'))
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'all done now' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(ws), { model: 'gpt-test' }, credential)

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('all done now')
    expect(call).toBe(2)
    const secondReqMessages = bodies[1].messages
    expect(
      secondReqMessages.some((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('trả lời trống')),
    ).toBe(true)
  })

  test('two consecutive empty replies fail the job with a clear error instead of succeeding silently', async () => {
    globalThis.fetch = (async () => jsonResponse(chatCompletion({ role: 'assistant', content: '' }, 'stop'))) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(ws), { model: 'gpt-test' }, credential)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/rỗng/)
  })

  test('the originally reported bug: going silent right after a tool call no longer reports job success', async () => {
    let call = 0
    globalThis.fetch = (async () => {
      call++
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_directory', arguments: '{}' } }],
            },
            'tool_calls',
          ),
        )
      }
      // Model goes silent forever after the tool call — this is the exact bug from the task report.
      return jsonResponse(chatCompletion({ role: 'assistant', content: '' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(ws), { model: 'gpt-test' }, credential)

    expect(result.ok).toBe(false)
    expect(call).toBe(3) // tool-call turn, then nudge turn, then still-empty turn → fail
  })
})

describe('OpenAiCompatibleProvider — tool usage preamble', () => {
  let ws: string
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-openai-preamble-ws-'))
  })
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true })
  })

  test('lists exactly the base 4 tools when extraTools is unset', async () => {
    let seenSystem = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenSystem = JSON.parse(String(init?.body)).messages[0].content
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'ok' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    await provider.execute(baseRequest(ws), { model: 'gpt-test' }, credential)

    expect(seenSystem).toContain('read_file')
    expect(seenSystem).toContain('list_directory')
    expect(seenSystem).not.toContain('run_command')
    expect(seenSystem).toContain('be helpful') // the agent's own systemPrompt still follows the preamble
  })

  test('lists run_command once extraTools includes shell', async () => {
    let seenSystem = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenSystem = JSON.parse(String(init?.body)).messages[0].content
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'ok' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    await provider.execute(baseRequest(ws), { model: 'gpt-test', extraTools: ['shell'] }, credential)

    expect(seenSystem).toContain('run_command')
  })
})

describe('OpenAiCompatibleProvider — extraTools (opt-in shell/git/search/web)', () => {
  let ws: string
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-openai-extra-ws-'))
  })
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true })
  })
  afterEach(() => {
    delete process.env.BRAVE_SEARCH_API_KEY
  })

  test('without extraTools, only the base 4 file-ops are registered', async () => {
    let seenTools: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenTools = JSON.parse(String(init?.body)).tools
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'ok' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    await provider.execute(baseRequest(ws), { model: 'gpt-test' }, credential)

    expect(seenTools.map((t: any) => t.function.name).sort()).toEqual(['edit_file', 'list_directory', 'read_file', 'write_file'])
  })

  test('extraTools:["shell"] registers run_command and executes an allowlisted binary end-to-end', async () => {
    let call = 0
    const bodies: Array<Record<string, any>> = []
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
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'run_command', arguments: JSON.stringify({ command: 'bun', args: ['-e', "console.log('shell-ok')"] }) },
                },
              ],
            },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'done' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(ws), { model: 'gpt-test', extraTools: ['shell'] }, credential)

    expect(result.ok).toBe(true)
    expect(bodies[0].tools.map((t: any) => t.function.name)).toContain('run_command')
    const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool')
    const outcome = JSON.parse(toolMsg.content)
    expect(outcome.ok).toBe(true)
    expect(outcome.stdout).toContain('shell-ok')
  })

  test('run_command rejects a binary outside the allowlist without registering shell access implicitly', async () => {
    let call = 0
    const bodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'rm', args: ['-rf', '/'] }) } }],
            },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'blocked' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(ws), { model: 'gpt-test', extraTools: ['shell'] }, credential)

    expect(result.ok).toBe(true)
    const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool')
    expect(JSON.parse(toolMsg.content)).toEqual({ ok: false, error: expect.stringContaining('không nằm trong allowlist') })
  })

  test('extraTools:["git"] registers git_status/git_diff/git_log and maps them onto the sandbox git ops', async () => {
    let call = 0
    const bodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) {
        return jsonResponse(
          chatCompletion({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'git_status', arguments: '{}' } }] }, 'tool_calls'),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'checked' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(ws), { model: 'gpt-test', extraTools: ['git'] }, credential)

    expect(result.ok).toBe(true)
    expect(bodies[0].tools.map((t: any) => t.function.name)).toEqual(expect.arrayContaining(['git_status', 'git_diff', 'git_log']))
    const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool')
    const outcome = JSON.parse(toolMsg.content)
    // `ws` isn't a git repo — a structured `ok:false` with an exit code, not "unknown tool" and not a thrown error.
    expect(outcome.ok).toBe(false)
    expect(typeof outcome.exitCode).toBe('number')
  })

  test('extraTools:["search"] registers search_files and finds a literal match', async () => {
    fs.writeFileSync(path.join(ws, 'needle-file.txt'), 'contains needle here\n')
    let call = 0
    const bodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_files', arguments: JSON.stringify({ pattern: 'needle' }) } }] },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'found' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    const result = await provider.execute(baseRequest(ws), { model: 'gpt-test', extraTools: ['search'] }, credential)

    expect(result.ok).toBe(true)
    const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool')
    const outcome = JSON.parse(toolMsg.content)
    expect(outcome.ok).toBe(true)
    expect(outcome.matches.some((m: any) => m.file === 'needle-file.txt')).toBe(true)
  })

  test('web_search is absent from the schema when BRAVE_SEARCH_API_KEY is unset, even with extraTools:["web"]', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY
    let seenTools: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenTools = JSON.parse(String(init?.body)).tools
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'ok' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    await provider.execute(baseRequest(ws), { model: 'gpt-test', extraTools: ['web'] }, credential)

    const names = seenTools.map((t: any) => t.function.name)
    expect(names).not.toContain('web_search')
    expect(names).toContain('fetch_url') // fetch_url only needs 'web' opted in, not the Brave key
  })

  test('web_search appears in the schema once BRAVE_SEARCH_API_KEY is configured', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'brave-test-key'
    let seenTools: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenTools = JSON.parse(String(init?.body)).tools
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'ok' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    await provider.execute(baseRequest(ws), { model: 'gpt-test', extraTools: ['web'] }, credential)

    expect(seenTools.map((t: any) => t.function.name)).toContain('web_search')
  })
})

describe('OpenAiCompatibleProvider — job log: system prompt + tool-call outcome (Bug 1/2 fix)', () => {
  let ws: string
  let logDir: string
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-openai-log-ws-'))
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-openai-log-'))
  })
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true })
    fs.rmSync(logDir, { recursive: true, force: true })
  })

  test('the real system prompt sent to the model is written to the job log, before the model responds', async () => {
    const logPath = path.join(logDir, 'system-prompt.log')
    globalThis.fetch = (async () => jsonResponse(chatCompletion({ role: 'assistant', content: 'all done' }, 'stop'))) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    await provider.execute({ ...baseRequest(ws), metadata: { logPath } }, { model: 'gpt-test' }, credential)

    const log = fs.readFileSync(logPath, 'utf8')
    const systemIdx = log.indexOf('be helpful')
    const answerIdx = log.indexOf('all done')
    expect(systemIdx).toBeGreaterThan(-1)
    expect(answerIdx).toBeGreaterThan(systemIdx)
    expect(log.split('be helpful').length - 1).toBe(1)
  })

  test('a successful tool call is logged with a distinguishable "ok" outcome', async () => {
    const logPath = path.join(logDir, 'tool-ok.log')
    let call = 0
    globalThis.fetch = (async () => {
      call++
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_directory', arguments: '{}' } }] },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'listed' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    await provider.execute({ ...baseRequest(ws), metadata: { logPath } }, { model: 'gpt-test' }, credential)

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toMatch(/\[tool\] list_directory .* → ok/)
  })

  test('a failing tool call is logged with a FAIL outcome distinguishable from success', async () => {
    const logPath = path.join(logDir, 'tool-fail.log')
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
                { id: 'c1', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ path: 'missing.md', old_string: 'x', new_string: 'y' }) } },
              ],
            },
            'tool_calls',
          ),
        )
      }
      return jsonResponse(chatCompletion({ role: 'assistant', content: 'reported failure' }, 'stop'))
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
    await provider.execute({ ...baseRequest(ws), metadata: { logPath } }, { model: 'gpt-test' }, credential)

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toMatch(/\[tool\] edit_file .* → FAIL:/)
  })
})

/* ═══ #379 · Tdf943817 — bridge tool MCP vào vòng tool-use (openai SDK) ═══════ */

// `beforeEach` 🚫 có trong khối import đầu file — khai thêm ở ĐÂY thay vì sửa
// dòng đó, để diff của khối này 🚫 chạm phần trên.
import { beforeEach } from 'bun:test'
import { mcpRegistry } from '../../../../../../src/features/mcp/business/McpRegistry.js'
import { ToolBridgeMcpDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/ToolBridgeMcpDelivery.js'
import { RunnerCredentialResolver } from '../../../../../../src/features/runner/business/RunnerCredentialResolver.js'

/** Bridge y hệt bản `registry.ts` lắp cho họ `ai-api` — provider dựng tay mặc định `NoMcpDelivery`. */
const mcpToolBridge = new ToolBridgeMcpDelivery(new RunnerCredentialResolver())

/**
 * TC-P6-02 · TC-P6-05 · TC-P6-06 (vế openai) · TC-P6-10 · TC-P6-20.
 *
 * Khuôn tool của SDK này KHÁC Anthropic (`{ type:'function', function:{…} }`),
 * nên mọi ca phải chạy riêng — assert ở suite Anthropic rồi suy sang đây đúng là
 * thứ `test-spec.md` §2.3 cấm.
 */
describe('OpenAiCompatibleProvider — tool MCP (#379)', () => {
  const MCP_CANARY = 'sk-test-LEAKCANARY-0123456789'
  const FIXTURE = path.join(
    import.meta.dir,
    '../../../../features/mcp/business/fake-mcp-server.mjs',
  )
  const BASELINE = JSON.parse(
    fs.readFileSync(path.join(import.meta.dir, 'aiApiTools.base-4c58b44.json'), 'utf8'),
  ) as { baseSha: string; snapshots: Record<string, { tools: unknown; system: unknown }> }

  let mcpWorkspace: string
  let mcpHome: string
  const prevBrave = process.env.BRAVE_SEARCH_API_KEY

  beforeEach(() => {
    mcpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-p6-openai-home-'))
    mcpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-p6-openai-ws-'))
    process.env.DEV_TEAM_DASHBOARD_HOME = mcpHome
    delete process.env.BRAVE_SEARCH_API_KEY
  })

  afterEach(() => {
    process.env.DEV_TEAM_DASHBOARD_HOME = home
    if (prevBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY
    else process.env.BRAVE_SEARCH_API_KEY = prevBrave
    fs.rmSync(mcpHome, { recursive: true, force: true })
    fs.rmSync(mcpWorkspace, { recursive: true, force: true })
  })

  function seedMcp(id: string, env: Record<string, string> = {}) {
    mcpRegistry.upsert({
      id,
      label: id,
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE, 'ok'],
      env: { FAKE_MCP_SERVER_NAME: id, ...env },
    })
  }

  /** Request đúng y hệt bản sinh baseline — 🚫 lệch một field nào. */
  function baselineRequest(): ExecuteRequest {
    return {
      jobId: 'job-baseline',
      resolvedAgent: { ref: 'agent', name: 'agent', description: '', systemPrompt: 'be helpful', skills: [] },
      userPrompt: 'xin chào',
      workspace: mcpWorkspace,
    }
  }

  const finalTurn = () => jsonResponse(chatCompletion({ role: 'assistant', content: 'xong' }, 'stop', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }))

  function systemOf(body: any): string[] {
    return (body.messages ?? []).filter((m: any) => m.role === 'system').map((m: any) => m.content)
  }

  async function captureBody(runnerConfig: Record<string, unknown>, req = baselineRequest()) {
    const bodies: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return finalTurn()
    }) as unknown as typeof fetch
    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test', mcpToolBridge)
    const result = await provider.execute(req, { model: 'm', ...runnerConfig }, credential)
    return { bodies, result }
  }

  // TC-P6-02 ⭐
  test('TC-P6-02: 🚫 bật MCP, `orchestratorJob !== true` ⇒ `tools` + preamble BYTE-IDENTICAL base', async () => {
    seedMcp('on1')
    const { bodies, result } = await captureBody({})

    expect(result.ok).toBe(true)
    expect(BASELINE.baseSha).toBe('4c58b44')
    expect(JSON.stringify(bodies[0].tools)).toBe(
      JSON.stringify(BASELINE.snapshots['openai.noExtras'].tools),
    )
    expect(JSON.stringify(systemOf(bodies[0]))).toBe(
      JSON.stringify(BASELINE.snapshots['openai.noExtras'].system),
    )
  }, 30_000)

  // TC-P6-03 (vế openai)
  test('TC-P6-03: có `extraTools` mà 🚫 MCP ⇒ vẫn byte-identical base', async () => {
    const { bodies } = await captureBody({ extraTools: ['shell', 'git', 'search', 'web'] })

    expect(JSON.stringify(bodies[0].tools)).toBe(
      JSON.stringify(BASELINE.snapshots['openai.withExtras'].tools),
    )
    expect(JSON.stringify(systemOf(bodies[0]))).toBe(
      JSON.stringify(BASELINE.snapshots['openai.withExtras'].system),
    )
  }, 30_000)

  // TC-P6-05 ⭐ · TC-P6-06 (vế openai)
  test('TC-P6-05 / TC-P6-06: tool MCP đúng khuôn `{type:function, function:{…}}` + preamble liệt kê', async () => {
    seedMcp('fs-local', { FAKE_MCP_TOOLS: 'read_file,ping' })
    const { bodies } = await captureBody({ mcpServers: ['fs-local'] })

    const baseTools = BASELINE.snapshots['openai.noExtras'].tools as any[]
    const tools = bodies[0].tools as any[]
    expect(tools).toHaveLength(baseTools.length + 2)
    expect(JSON.stringify(tools.slice(0, baseTools.length))).toBe(JSON.stringify(baseTools))

    const added = tools.slice(baseTools.length)
    expect(added.map((t) => t.function.name).sort()).toEqual([
      'mcp__fs-local__ping',
      'mcp__fs-local__read_file',
    ])
    for (const tool of added) {
      expect(tool.type).toBe('function')
      expect(Object.keys(tool).sort()).toEqual(['function', 'type'])
      expect(Object.keys(tool.function).sort()).toEqual(['description', 'name', 'parameters'])
      expect((tool.function.parameters as any).type).toBe('object')
    }

    const system = systemOf(bodies[0]).join('\n')
    for (const tool of added) {
      expect(system).toContain(`- ${tool.function.name}: `)
      expect(system).toContain(tool.function.description)
    }
  }, 30_000)

  // TC-P6-10 (vế openai)
  test('TC-P6-10: tool MCP trùng tên built-in ⇒ built-in vẫn chạy built-in', async () => {
    seedMcp('srv', { FAKE_MCP_TOOLS: 'read_file' })
    fs.writeFileSync(path.join(mcpWorkspace, 'co-that.md'), 'noi dung that', 'utf8')

    const bodies: any[] = []
    let call = 0
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      call++
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'tc1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'co-that.md' }) } },
              ],
            },
            'tool_calls',
          ),
        )
      }
      return finalTurn()
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test', mcpToolBridge)
    const result = await provider.execute(
      baselineRequest(),
      { model: 'm', mcpServers: ['srv'] },
      credential,
    )

    expect(result.ok).toBe(true)
    const names = (bodies[0].tools as any[]).map((t) => t.function.name)
    expect(names).toContain('read_file')
    expect(names).toContain('mcp__srv__read_file')

    const toolMessages = (bodies[1].messages as any[]).filter((m: any) => m.role === 'tool')
    expect(JSON.stringify(toolMessages)).toContain('noi dung that')
  }, 30_000)

  // TC-P6-20 (vế openai)
  test('TC-P6-20: kết quả tool MCP chứa canary ⇒ 🚫 lọt vào ExecuteResult / log', async () => {
    seedMcp('srv', { FAKE_MCP_TOOLS: 'echo', FAKE_MCP_TOOL_SECRET: MCP_CANARY })
    const logPath = path.join(mcpHome, 'job.log')
    fs.writeFileSync(logPath, '', 'utf8')

    const bodies: any[] = []
    let call = 0
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      call++
      if (call === 1) {
        return jsonResponse(
          chatCompletion(
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'tc1', type: 'function', function: { name: 'mcp__srv__echo', arguments: JSON.stringify({ text: 'noi dung' }) } },
              ],
            },
            'tool_calls',
          ),
        )
      }
      return finalTurn()
    }) as unknown as typeof fetch

    const provider = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test', mcpToolBridge)
    const result = await provider.execute(
      { ...baselineRequest(), metadata: { logPath } },
      { model: 'm', mcpServers: ['srv'] },
      credential,
    )

    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain(MCP_CANARY)
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain(MCP_CANARY)
    expect(JSON.stringify(bodies[1])).not.toContain(MCP_CANARY)
  }, 30_000)
})
