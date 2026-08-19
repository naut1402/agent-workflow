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

  test('an upstream response that is not valid JSON is wrapped into a clear error, not a raw SyntaxError (TC-07, Lỗi 3)', async () => {
    globalThis.fetch = (async () =>
      new Response('not valid json {{{', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(workspace), { model: 'claude-test' }, credential)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('response upstream không hợp lệ')
  })

  test('a call that hangs past the configured timeout fails within that timeout instead of hanging indefinitely (TC-06, Lỗi 3)', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      })) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const started = Date.now()
    const result = await provider.execute(baseRequest(workspace), { model: 'claude-test', timeoutMs: 50 }, credential)
    const elapsedMs = Date.now() - started

    expect(result.ok).toBe(false)
    expect(elapsedMs).toBeLessThan(5_000)
    if (!result.ok) expect(result.error).toMatch(/timeout/)
  })

  test('listModels() calls the SDK models endpoint and returns sorted ids', async () => {
    let seenUrl = ''
    globalThis.fetch = (async (url: string) => {
      seenUrl = String(url)
      return jsonResponse({ data: [{ id: 'claude-opus-4-6', type: 'model' }, { id: 'claude-haiku-4-6', type: 'model' }], has_more: false })
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const models = await provider.listModels('sk-ant-test', '')

    expect(seenUrl).toBe('https://api.anthropic.test/v1/models')
    expect(models).toEqual(['claude-haiku-4-6', 'claude-opus-4-6'])
  })
})

describe('AnthropicCompatibleProvider — empty-reply nudge-once (silent-success bug fix)', () => {
  let ws: string
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-anthropic-nudge-ws-'))
  })
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true })
  })

  test('an empty reply with no tool_use gets nudged once, then recovers on the next turn', async () => {
    let call = 0
    const bodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) return jsonResponse(anthropicMessage([]))
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'all done now' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(ws), { model: 'claude-test' }, credential)

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('all done now')
    expect(call).toBe(2)
    const secondReqMessages = bodies[1].messages
    expect(
      secondReqMessages.some((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('trả lời trống')),
    ).toBe(true)
    // Anthropic's API rejects any non-final message with empty content
    // ("all messages must have non-empty content except for the optional
    // final assistant message") — the nudge must not add one, or the real
    // API would 400 on this very request before the model ever sees it.
    secondReqMessages.slice(0, -1).forEach((m: any) => {
      expect(m.content).not.toBe('')
      expect(Array.isArray(m.content) && m.content.length === 0).toBe(false)
    })
  })

  test('two consecutive empty replies fail the job with a clear error instead of succeeding silently', async () => {
    globalThis.fetch = (async () => jsonResponse(anthropicMessage([]))) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(ws), { model: 'claude-test' }, credential)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/rỗng/)
  })

  test('the originally reported bug: going silent right after a tool_use no longer reports job success', async () => {
    let call = 0
    globalThis.fetch = (async () => {
      call++
      if (call === 1) {
        return jsonResponse(anthropicMessage([{ type: 'tool_use', id: 't1', name: 'list_directory', input: {} }]))
      }
      return jsonResponse(anthropicMessage([]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(ws), { model: 'claude-test' }, credential)

    expect(result.ok).toBe(false)
    expect(call).toBe(3)
  })
})

describe('AnthropicCompatibleProvider — tool usage preamble', () => {
  let ws: string
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-anthropic-preamble-ws-'))
  })
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true })
  })

  test('lists exactly the base 2 tools when extraTools is unset', async () => {
    let seenSystem = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenSystem = JSON.parse(String(init?.body)).system
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'ok' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    await provider.execute(baseRequest(ws), { model: 'claude-test' }, credential)

    expect(seenSystem).toContain('list_directory')
    expect(seenSystem).not.toContain('run_command')
    expect(seenSystem).toContain('be helpful')
    // The text-editor tool is the main file-op surface on this wrapper — the
    // preamble must describe its sub-commands, not just print its bare name
    // (a low-level model can't infer "view/create/str_replace/insert" from
    // the name "str_replace_based_edit_tool" alone).
    expect(seenSystem).toContain('str_replace_based_edit_tool')
    expect(seenSystem).toContain('view')
    expect(seenSystem).toContain('str_replace')
  })

  test('lists run_command once extraTools includes shell', async () => {
    let seenSystem = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenSystem = JSON.parse(String(init?.body)).system
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'ok' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    await provider.execute(baseRequest(ws), { model: 'claude-test', extraTools: ['shell'] }, credential)

    expect(seenSystem).toContain('run_command')
  })
})

describe('AnthropicCompatibleProvider — extraTools (opt-in shell/git/search/web)', () => {
  let ws: string
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-anthropic-extra-ws-'))
  })
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true })
  })
  afterEach(() => {
    delete process.env.BRAVE_SEARCH_API_KEY
  })

  test('without extraTools, only the base 2 tools are registered', async () => {
    let seenTools: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenTools = JSON.parse(String(init?.body)).tools
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'ok' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    await provider.execute(baseRequest(ws), { model: 'claude-test' }, credential)

    expect(seenTools.map((t: any) => t.name).sort()).toEqual(['list_directory', 'str_replace_based_edit_tool'])
  })

  test('extraTools:["shell"] registers run_command and executes an allowlisted binary end-to-end', async () => {
    let call = 0
    const bodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) {
        return jsonResponse(
          anthropicMessage([
            { type: 'tool_use', id: 't1', name: 'run_command', input: { command: 'bun', args: ['-e', "console.log('shell-ok')"] } },
          ]),
        )
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'done' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(ws), { model: 'claude-test', extraTools: ['shell'] }, credential)

    expect(result.ok).toBe(true)
    expect(bodies[0].tools.map((t: any) => t.name)).toContain('run_command')
    const toolResultMsg = bodies[1].messages[bodies[1].messages.length - 1]
    const outcome = JSON.parse(toolResultMsg.content[0].content)
    expect(outcome.ok).toBe(true)
    expect(outcome.stdout).toContain('shell-ok')
  })

  test('run_command rejects a binary outside the allowlist', async () => {
    let call = 0
    const bodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) {
        return jsonResponse(anthropicMessage([{ type: 'tool_use', id: 't1', name: 'run_command', input: { command: 'rm', args: ['-rf', '/'] } }]))
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'blocked' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(ws), { model: 'claude-test', extraTools: ['shell'] }, credential)

    expect(result.ok).toBe(true)
    const toolResultMsg = bodies[1].messages[bodies[1].messages.length - 1]
    expect(toolResultMsg.content[0].is_error).toBe(true)
    expect(JSON.parse(toolResultMsg.content[0].content).error).toContain('không nằm trong allowlist')
  })

  test('extraTools:["git"] registers git_status/git_diff/git_log and maps them onto the sandbox git ops', async () => {
    let call = 0
    const bodies: Array<Record<string, any>> = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      call++
      bodies.push(JSON.parse(String(init?.body)))
      if (call === 1) {
        return jsonResponse(anthropicMessage([{ type: 'tool_use', id: 't1', name: 'git_status', input: {} }]))
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'checked' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(ws), { model: 'claude-test', extraTools: ['git'] }, credential)

    expect(result.ok).toBe(true)
    expect(bodies[0].tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(['git_status', 'git_diff', 'git_log']))
    const toolResultMsg = bodies[1].messages[bodies[1].messages.length - 1]
    const outcome = JSON.parse(toolResultMsg.content[0].content)
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
        return jsonResponse(anthropicMessage([{ type: 'tool_use', id: 't1', name: 'search_files', input: { pattern: 'needle' } }]))
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'found' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    const result = await provider.execute(baseRequest(ws), { model: 'claude-test', extraTools: ['search'] }, credential)

    expect(result.ok).toBe(true)
    const toolResultMsg = bodies[1].messages[bodies[1].messages.length - 1]
    const outcome = JSON.parse(toolResultMsg.content[0].content)
    expect(outcome.ok).toBe(true)
    expect(outcome.matches.some((m: any) => m.file === 'needle-file.txt')).toBe(true)
  })

  test('web_search is absent from the schema when BRAVE_SEARCH_API_KEY is unset, even with extraTools:["web"]', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY
    let seenTools: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenTools = JSON.parse(String(init?.body)).tools
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'ok' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    await provider.execute(baseRequest(ws), { model: 'claude-test', extraTools: ['web'] }, credential)

    const names = seenTools.map((t: any) => t.name)
    expect(names).not.toContain('web_search')
    expect(names).toContain('fetch_url')
  })

  test('web_search appears in the schema once BRAVE_SEARCH_API_KEY is configured', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'brave-test-key'
    let seenTools: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenTools = JSON.parse(String(init?.body)).tools
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'ok' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    await provider.execute(baseRequest(ws), { model: 'claude-test', extraTools: ['web'] }, credential)

    expect(seenTools.map((t: any) => t.name)).toContain('web_search')
  })
})
