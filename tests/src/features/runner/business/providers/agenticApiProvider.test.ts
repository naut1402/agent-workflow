import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  AgenticApiProvider,
  type AgenticRunContext,
  type AgenticRunResult,
} from '../../../../../../src/features/runner/business/providers/agenticApiProvider.js'
import { readTranscriptTurns, loadSessionMessages } from '../../../../../../src/features/runner/business/providers/agentTranscriptStore.js'
import { storeSecret } from '../../../../../../src/features/runner/business/secretVault.js'
import type { CredentialProfile, ExecuteRequest } from '../../../../../../src/features/runner/business/types.js'

const originalFetch = globalThis.fetch
let home: string
let workspace: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-provider-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.FAKE_AGENTIC_KEY = 'sk-test-123'
  process.env.DASHBOARD_SECRET_KEY = 'test-passphrase'
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})

/** Minimal subclass exercising only the base class's template method — no real model call. */
class FakeAgenticProvider extends AgenticApiProvider {
  readonly providerId = 'fake-agentic-api'
  runConversationImpl: (ctx: AgenticRunContext) => Promise<AgenticRunResult> = async () => ({
    finalText: 'ok',
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    toolCalls: [],
    rawMessages: [],
  })

  protected runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult> {
    return this.runConversationImpl(ctx)
  }

  // Expose the protected sandbox helpers for direct unit testing.
  read(ws: string, p: string) {
    return this.readWorkspaceFile(ws, p)
  }
  write(ws: string, p: string, content: string) {
    return this.writeWorkspaceFile(ws, p, content)
  }
  edit(ws: string, p: string, oldStr: string, newStr: string) {
    return this.editWorkspaceFile(ws, p, oldStr, newStr)
  }
  list(ws: string, p?: string) {
    return this.listWorkspaceDirectory(ws, p)
  }
}

function credential(secretRef = 'env:FAKE_AGENTIC_KEY'): CredentialProfile {
  return { id: 'cred-1', provider: 'fake-agentic-api', label: 'Fake', secretRef }
}

function baseRequest(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    jobId: 'job-1',
    resolvedAgent: { ref: 'agent', name: 'agent', description: '', systemPrompt: 'be helpful', skills: [] },
    userPrompt: 'hello',
    workspace,
    ...overrides,
  }
}

describe('AgenticApiProvider — sandbox file-ops', () => {
  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-ws-'))
  })
  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  test('write then read a file under the workspace', () => {
    const p = new FakeAgenticProvider()
    expect(p.write(workspace, 'notes/a.md', 'hello world')).toEqual({ ok: true })
    expect(p.read(workspace, 'notes/a.md')).toEqual({ ok: true, content: 'hello world' })
  })

  test('read of a missing file returns a structured error, not a throw', () => {
    const p = new FakeAgenticProvider()
    const result = p.read(workspace, 'missing.md')
    expect(result.ok).toBe(false)
  })

  test('path traversal outside the workspace is rejected for every sandbox op', () => {
    const p = new FakeAgenticProvider()
    expect(p.read(workspace, '../../etc/passwd').ok).toBe(false)
    expect(p.write(workspace, '../escape.md', 'x').ok).toBe(false)
    expect(p.edit(workspace, '../escape.md', 'x', 'y').ok).toBe(false)
    expect(p.list(workspace, '..').ok).toBe(false)
    // Nothing should have been created outside the sandbox.
    expect(fs.existsSync(path.join(path.dirname(workspace), 'escape.md'))).toBe(false)
  })

  test('edit fails with a clear error when old_string is not found', () => {
    const p = new FakeAgenticProvider()
    p.write(workspace, 'b.md', 'one two three')
    const result = p.edit(workspace, 'b.md', 'nope', 'x')
    expect(result).toEqual({ ok: false, error: 'old_string not found' })
  })

  test('edit fails with a clear error when old_string is not unique', () => {
    const p = new FakeAgenticProvider()
    p.write(workspace, 'c.md', 'dup dup dup')
    const result = p.edit(workspace, 'c.md', 'dup', 'x')
    expect(result).toEqual({ ok: false, error: 'old_string not unique' })
  })

  test('edit replaces the single occurrence', () => {
    const p = new FakeAgenticProvider()
    p.write(workspace, 'd.md', 'one two three')
    expect(p.edit(workspace, 'd.md', 'two', 'TWO')).toEqual({ ok: true })
    expect(p.read(workspace, 'd.md')).toEqual({ ok: true, content: 'one TWO three' })
  })

  test('listWorkspaceDirectory lists entries relative to the workspace', () => {
    const p = new FakeAgenticProvider()
    p.write(workspace, 'list-dir/x.md', '1')
    p.write(workspace, 'list-dir/y.md', '2')
    const result = p.list(workspace, 'list-dir') as { ok: true; entries: string[] }
    expect(result.ok).toBe(true)
    expect(result.entries.sort()).toEqual(['x.md', 'y.md'])
  })
})

describe('AgenticApiProvider — validateCredential / capabilities', () => {
  test('accepts an env: secretRef', () => {
    const p = new FakeAgenticProvider()
    expect(p.validateCredential(credential())).toEqual({ ok: true, errors: [] })
  })

  test('rejects a non-env secretRef (e.g. cli-session)', () => {
    const p = new FakeAgenticProvider()
    expect(p.validateCredential(credential('cli-session')).ok).toBe(false)
  })

  test('accepts a stored: secretRef (pasted through ConnectionDialog)', () => {
    const p = new FakeAgenticProvider()
    expect(p.validateCredential(credential('stored:some-id'))).toEqual({ ok: true, errors: [] })
  })

  test('accepts an oauth: secretRef (Connect via browser)', () => {
    const p = new FakeAgenticProvider()
    expect(p.validateCredential(credential('oauth:some-id'))).toEqual({ ok: true, errors: [] })
  })

  test('capabilities reports non-streaming, single-concurrency, no agent file', () => {
    const p = new FakeAgenticProvider()
    expect(p.capabilities()).toEqual({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 })
  })
})

describe('AgenticApiProvider — execute() template method', () => {
  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-exec-ws-'))
  })
  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('missing/invalid API key fails fast without calling runConversation', async () => {
    const p = new FakeAgenticProvider()
    let called = false
    p.runConversationImpl = async () => {
      called = true
      return { finalText: '', usage: {}, toolCalls: [], rawMessages: [] }
    }
    const result = await p.execute(baseRequest(), {}, credential('cli-session'))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/API key/)
    expect(called).toBe(false)
  })

  test('runConversation throwing surfaces as a structured failure, not an unhandled rejection', async () => {
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => {
      throw new Error('model exploded')
    }
    const result = await p.execute(baseRequest(), {}, credential())
    expect(result.ok).toBe(false)
    expect(result.error).toBe('model exploded')
  })

  test('successful run writes transcript turns, persists rawMessages, and returns ExecuteResult', async () => {
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => ({
      finalText: 'final answer',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      toolCalls: [{ name: 'write_file', argsSummary: '{"path":"out.md"}' }],
      rawMessages: [{ role: 'user', content: 'hello' }],
    })
    fs.writeFileSync(path.join(workspace, 'out.md'), 'produced')

    const result = await p.execute(baseRequest({ produces: ['out.md', 'missing.md'] }), {}, credential())
    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('final answer')
    expect(result.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    expect(result.artifactsFound).toEqual(['out.md'])
    expect(typeof result.sessionId).toBe('string')

    const turns = readTranscriptTurns('fake-agentic-api', result.sessionId!)
    expect(turns.map((t) => t.role)).toEqual(['user', 'tool', 'assistant'])
    expect(turns[1]?.tool).toBe('write_file')

    expect(loadSessionMessages(result.sessionId!)).toEqual([{ role: 'user', content: 'hello' }])
  })

  test('resumeSessionId reuses the same session id and loads prior messages', async () => {
    const p = new FakeAgenticProvider()
    let seenPriorMessages: unknown[] = []
    p.runConversationImpl = async (ctx) => {
      seenPriorMessages = ctx.priorMessages
      return { finalText: 'again', usage: {}, toolCalls: [], rawMessages: [...ctx.priorMessages, { role: 'user', content: 'follow-up' }] }
    }

    const first = await p.execute(baseRequest(), {}, credential())
    const messagesBeforeResume = loadSessionMessages(first.sessionId!)
    const second = await p.execute(baseRequest({ resumeSessionId: first.sessionId! }), {}, credential())

    expect(second.sessionId).toBe(first.sessionId)
    expect(seenPriorMessages).toEqual(messagesBeforeResume)
  })

  test('req.signal is forwarded to runConversation — subclasses can thread it into fetch/SDK calls for cancelJob', async () => {
    const p = new FakeAgenticProvider()
    const controller = new AbortController()
    let seenSignal: AbortSignal | undefined
    p.runConversationImpl = async (ctx) => {
      seenSignal = ctx.signal
      return { finalText: 'ok', usage: {}, toolCalls: [], rawMessages: [] }
    }

    await p.execute(baseRequest({ signal: controller.signal }), {}, credential())

    expect(seenSignal).toBe(controller.signal)
    expect(seenSignal?.aborted).toBe(false)
  })

  test('a stored: secretRef (pasted secret) is resolved and passed through as the API key', async () => {
    storeSecret('cred-stored-1', { value: 'pasted-secret-value' })
    const p = new FakeAgenticProvider()
    let seenApiKey = ''
    p.runConversationImpl = async (ctx) => {
      seenApiKey = ctx.apiKey
      return { finalText: 'ok', usage: {}, toolCalls: [], rawMessages: [] }
    }
    const result = await p.execute(baseRequest(), {}, credential('stored:cred-stored-1'))
    expect(result.ok).toBe(true)
    expect(seenApiKey).toBe('pasted-secret-value')
  })

  test('an oauth: secretRef with a fresh token is resolved without any network call', async () => {
    storeSecret('cred-oauth-1', {
      accessToken: 'oauth-access-token',
      refreshToken: 'oauth-refresh-token',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response('{}')
    }) as unknown as typeof fetch

    const p = new FakeAgenticProvider()
    let seenApiKey = ''
    p.runConversationImpl = async (ctx) => {
      seenApiKey = ctx.apiKey
      return { finalText: 'ok', usage: {}, toolCalls: [], rawMessages: [] }
    }
    const result = await p.execute(baseRequest(), {}, credential('oauth:cred-oauth-1'))
    expect(result.ok).toBe(true)
    expect(seenApiKey).toBe('oauth-access-token')
    expect(fetchCalled).toBe(false)
  })

  test('an oauth: secretRef pointing at a missing/deleted vault entry fails without calling runConversation', async () => {
    const p = new FakeAgenticProvider()
    let called = false
    p.runConversationImpl = async () => {
      called = true
      return { finalText: '', usage: {}, toolCalls: [], rawMessages: [] }
    }
    const result = await p.execute(baseRequest(), {}, credential('oauth:never-connected'))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/connect again/)
    expect(called).toBe(false)
  })
})
