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

describe('AnthropicCompatibleProvider — job log: system prompt + tool-call outcome (Bug 1/2 fix)', () => {
  let ws: string
  let logDir: string
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-anthropic-log-ws-'))
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-anthropic-log-'))
  })
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true })
    fs.rmSync(logDir, { recursive: true, force: true })
  })

  test('the real system prompt sent to the model is written to the job log, before the model responds', async () => {
    const logPath = path.join(logDir, 'system-prompt.log')
    globalThis.fetch = (async () => jsonResponse(anthropicMessage([{ type: 'text', text: 'all done' }]))) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    await provider.execute({ ...baseRequest(ws), metadata: { logPath } }, { model: 'claude-test' }, credential)

    const log = fs.readFileSync(logPath, 'utf8')
    const systemIdx = log.indexOf('be helpful')
    const answerIdx = log.indexOf('all done')
    expect(systemIdx).toBeGreaterThan(-1)
    expect(answerIdx).toBeGreaterThan(systemIdx)
    // logged exactly once even though the same string could in principle
    // reappear in the model's own reply
    expect(log.split('be helpful').length - 1).toBe(1)
  })

  test('a successful tool call is logged with a distinguishable "ok" outcome', async () => {
    const logPath = path.join(logDir, 'tool-ok.log')
    let call = 0
    globalThis.fetch = (async () => {
      call++
      if (call === 1) {
        return jsonResponse(anthropicMessage([{ type: 'tool_use', id: 't1', name: 'list_directory', input: { path: '.' } }]))
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'listed' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    await provider.execute({ ...baseRequest(ws), metadata: { logPath } }, { model: 'claude-test' }, credential)

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
          anthropicMessage([
            { type: 'tool_use', id: 't1', name: 'str_replace_based_edit_tool', input: { command: 'str_replace', path: 'missing.md', old_str: 'x', new_str: 'y' } },
          ]),
        )
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'reported failure' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test')
    await provider.execute({ ...baseRequest(ws), metadata: { logPath } }, { model: 'claude-test' }, credential)

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toMatch(/\[tool\] str_replace_based_edit_tool .* → FAIL:/)
  })
})

/* ═══ #379 · Tdf943817 — bridge tool MCP vào vòng tool-use (anthropic SDK) ════ */

// `beforeEach` 🚫 có trong khối import đầu file — khai thêm ở ĐÂY thay vì sửa
// dòng đó, để diff của khối này 🚫 chạm phần trên.
import { beforeEach } from 'bun:test'
import { mcpRegistry } from '../../../../../../src/features/mcp/business/McpRegistry.js'
import { ToolBridgeMcpDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/ToolBridgeMcpDelivery.js'
import { RunnerCredentialResolver } from '../../../../../../src/features/runner/business/RunnerCredentialResolver.js'

/** Bridge y hệt bản `registry.ts` lắp cho họ `ai-api` — provider dựng tay mặc định `NoMcpDelivery`. */
const mcpToolBridge = new ToolBridgeMcpDelivery(new RunnerCredentialResolver())

/**
 * TC-P6-01 · TC-P6-03 · TC-P6-04 · TC-P6-06 · TC-P6-10 (vế "built-in vẫn thắng").
 *
 * Bề mặt: **body request thật gửi lên SDK** — `tools` và `system`. Đây là thứ
 * model nhìn thấy; mọi phát biểu của #379 nói về nó.
 *
 * ⚠️ Baseline byte-identical chụp trên base `4c58b44` (`aiApiTools.base-4c58b44.json`,
 * `test-spec.md` A-6). So với một bản sinh lại trên HEAD 🚫 chứng minh được gì.
 */
describe('AnthropicCompatibleProvider — tool MCP (#379)', () => {
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
    mcpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-p6-anthropic-home-'))
    mcpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-p6-anthropic-ws-'))
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

  /** Chạy một lượt, trả body request ĐẦU TIÊN gửi lên SDK. */
  async function captureBody(runnerConfig: Record<string, unknown>, req = baselineRequest()) {
    const bodies: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'xong' }], { input_tokens: 1, output_tokens: 1 }))
    }) as unknown as typeof fetch
    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test', mcpToolBridge)
    const result = await provider.execute(req, { model: 'm', ...runnerConfig }, credential)
    return { bodies, result }
  }

  // TC-P6-01 ⭐
  test('TC-P6-01: 🚫 bật MCP, `orchestratorJob !== true` ⇒ `tools` + preamble BYTE-IDENTICAL base', async () => {
    seedMcp('on1') // có server trong store nhưng Connection 🚫 bật ⇒ bridge null
    const { bodies, result } = await captureBody({})

    expect(result.ok).toBe(true)
    expect(BASELINE.baseSha).toBe('4c58b44')
    expect(JSON.stringify(bodies[0].tools)).toBe(
      JSON.stringify(BASELINE.snapshots['anthropic.noExtras'].tools),
    )
    expect(JSON.stringify(bodies[0].system)).toBe(
      JSON.stringify(BASELINE.snapshots['anthropic.noExtras'].system),
    )
  }, 30_000)

  // TC-P6-03 — `extraTools` bật ⇒ bridge `null` vẫn 🚫 đụng đường tool sẵn có.
  test('TC-P6-03: có `extraTools` mà 🚫 MCP ⇒ vẫn byte-identical base', async () => {
    const { bodies } = await captureBody({ extraTools: ['shell', 'git', 'search', 'web'] })

    expect(JSON.stringify(bodies[0].tools)).toBe(
      JSON.stringify(BASELINE.snapshots['anthropic.withExtras'].tools),
    )
    expect(JSON.stringify(bodies[0].system)).toBe(
      JSON.stringify(BASELINE.snapshots['anthropic.withExtras'].system),
    )
  }, 30_000)

  // TC-P6-04 ⭐ · TC-P6-06 ⭐
  test('TC-P6-04 / TC-P6-06: 1 server 2 tool ⇒ `tools` thêm 2 entry đúng khuôn + preamble liệt kê', async () => {
    seedMcp('fs-local', { FAKE_MCP_TOOLS: 'read_file,ping' })
    const { bodies } = await captureBody({ mcpServers: ['fs-local'] })

    const baseTools = BASELINE.snapshots['anthropic.noExtras'].tools as any[]
    const tools = bodies[0].tools as any[]
    expect(tools).toHaveLength(baseTools.length + 2)
    // Tool sẵn có giữ NGUYÊN và đứng TRƯỚC — 🚫 chen, 🚫 đổi thứ tự.
    expect(JSON.stringify(tools.slice(0, baseTools.length))).toBe(JSON.stringify(baseTools))

    const added = tools.slice(baseTools.length)
    expect(added.map((t) => t.name).sort()).toEqual([
      'mcp__fs-local__ping',
      'mcp__fs-local__read_file',
    ])
    for (const tool of added) {
      // Khuôn của SDK Anthropic: `{ name, description, input_schema }`.
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name'])
      expect(typeof tool.description).toBe('string')
      expect(tool.input_schema).toBeTruthy()
      expect((tool.input_schema as any).type).toBe('object')
    }

    // TC-P6-06 — preamble BẮT BUỘC liệt kê tên ĐÃ PREFIX + mô tả: dòng tiêu đề
    // ngay trên nói với model rằng danh sách này là DUY NHẤT.
    const system = String(bodies[0].system)
    for (const tool of added) {
      expect(system).toContain(`- ${tool.name}: `)
      expect(system).toContain(tool.description)
    }
  }, 30_000)

  /**
   * TC-P6-10 ⭐ (vế "built-in vẫn thắng") — server MCP khai tool TRÙNG TÊN tool
   * sẵn có. `list_directory` built-in phải vẫn chạy built-in; bản MCP chỉ gọi
   * được qua tên đã prefix. 🚫 Tool nào bị che.
   */
  test('TC-P6-10: tool MCP trùng tên built-in ⇒ built-in vẫn chạy built-in', async () => {
    seedMcp('srv', { FAKE_MCP_TOOLS: 'list_directory' })
    fs.mkdirSync(path.join(mcpWorkspace, 'thu-muc'), { recursive: true })
    fs.writeFileSync(path.join(mcpWorkspace, 'thu-muc', 'ben-trong.md'), 'x', 'utf8')

    const bodies: any[] = []
    let call = 0
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      call++
      if (call === 1) {
        return jsonResponse(
          anthropicMessage([
            { type: 'tool_use', id: 'tu_1', name: 'list_directory', input: { path: 'thu-muc' } },
          ]),
        )
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'xong' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test', mcpToolBridge)
    const result = await provider.execute(
      baselineRequest(),
      { model: 'm', mcpServers: ['srv'] },
      credential,
    )

    expect(result.ok).toBe(true)
    // Hai tên cùng tồn tại, 🚫 cái nào bị che.
    const names = (bodies[0].tools as any[]).map((t) => t.name)
    expect(names).toContain('list_directory')
    expect(names).toContain('mcp__srv__list_directory')

    // Lời gọi tên TRẦN đi vào sandbox built-in ⇒ kết quả là entry của workspace.
    const toolResult = JSON.stringify(
      (bodies[1].messages as any[]).flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])),
    )
    expect(toolResult).toContain('ben-trong.md')
  }, 30_000)

  // TC-P6-20 (vế provider) — kết quả tool MCP chứa canary ⇒ 🚫 lọt vào ExecuteResult/log.
  test('TC-P6-20: kết quả tool MCP chứa canary ⇒ 🚫 lọt vào ExecuteResult', async () => {
    seedMcp('srv', { FAKE_MCP_TOOLS: 'echo', FAKE_MCP_TOOL_SECRET: MCP_CANARY })
    const logPath = path.join(mcpHome, 'job.log')
    fs.writeFileSync(logPath, '', 'utf8')

    let call = 0
    const bodies: any[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      call++
      if (call === 1) {
        return jsonResponse(
          anthropicMessage([
            { type: 'tool_use', id: 'tu_1', name: 'mcp__srv__echo', input: { text: 'noi dung' } },
          ]),
        )
      }
      return jsonResponse(anthropicMessage([{ type: 'text', text: 'xong' }]))
    }) as unknown as typeof fetch

    const provider = new AnthropicCompatibleProvider('anthropic-api', 'https://api.anthropic.test', mcpToolBridge)
    const result = await provider.execute(
      { ...baselineRequest(), metadata: { logPath } },
      { model: 'm', mcpServers: ['srv'] },
      credential,
    )

    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain(MCP_CANARY)
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain(MCP_CANARY)
    // Kết quả tool gửi lại cho model cũng đã mask.
    expect(JSON.stringify(bodies[1])).not.toContain(MCP_CANARY)
  }, 30_000)
})
