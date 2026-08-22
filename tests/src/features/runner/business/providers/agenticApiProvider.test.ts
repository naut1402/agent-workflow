import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  AgenticApiProvider,
  AgenticRunError,
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

  // Expose the new opt-in extra-tool helpers for direct unit testing.
  resolveExtraToolsPublic(runnerConfig: Record<string, any>) {
    return this.resolveExtraTools(runnerConfig)
  }
  isWebSearchConfiguredPublic() {
    return this.isWebSearchConfigured()
  }
  preamble(tools: string[]) {
    return this.buildToolUsagePreamble(tools)
  }
  projectContextPreamble(req: ExecuteRequest) {
    return this.buildProjectContextPreamble(req)
  }
  runCmd(ws: string, command: string, args: string[]) {
    return this.runShellCommand(ws, command, args)
  }
  gitStatusPublic(ws: string) {
    return this.gitStatus(ws)
  }
  gitDiffPublic(ws: string, p?: string, staged?: boolean) {
    return this.gitDiff(ws, p, staged)
  }
  gitLogPublic(ws: string, limit?: number) {
    return this.gitLog(ws, limit)
  }
  searchFilesPublic(ws: string, pattern: string, p?: string) {
    return this.searchFiles(ws, pattern, p)
  }
  webSearchPublic(query: string) {
    return this.webSearch(query)
  }
  fetchUrlPublic(url: string) {
    return this.fetchUrl(url)
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
      toolCalls: [{ name: 'write_file', argsSummary: '{"path":"out.md"}', ok: true, resultSummary: '{"ok":true}' }],
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

  test('a streaming subclass writes transcript turns as runConversation progresses, not only at the end', async () => {
    const p = new FakeAgenticProvider()
    const seenDuringRun: string[][] = []
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onToolCall({ name: 'list_directory', argsSummary: '{"path":"."}', ok: true, resultSummary: '{"ok":true,"entries":[]}' })
      // The tool-call turn must already be on disk before the loop moves on —
      // that's the whole point of streaming instead of batching at the end.
      seenDuringRun.push(readTranscriptTurns('fake-agentic-api', 'stream-session-1').map((t) => t.role))
      ctx.handlers.onAssistantChunk('final answer', { done: true })
      return {
        finalText: 'final answer',
        usage: {},
        toolCalls: [{ name: 'list_directory', argsSummary: '{"path":"."}', ok: true, resultSummary: '{"ok":true,"entries":[]}' }],
        rawMessages: [],
      }
    }

    // sessionId defaults to a fresh mintSessionId() when neither is set on the
    // request, so pin one via resumeSessionId to read it back deterministically.
    const result = await p.execute(baseRequest({ resumeSessionId: 'stream-session-1' }), {}, credential())
    expect(result.ok).toBe(true)

    expect(seenDuringRun[0]).toEqual(['user', 'tool']) // seen mid-run, before onAssistantChunk / return

    const turns = readTranscriptTurns('fake-agentic-api', result.sessionId!)
    expect(turns.map((t) => t.role)).toEqual(['user', 'tool', 'assistant'])
    expect(turns[2]?.text).toBe('final answer')
  })

  test('a streaming subclass emitting chunks with done:false buffers them into a single committed turn', async () => {
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onAssistantChunk('Hello, ', { done: false })
      ctx.handlers.onAssistantChunk('world', { done: false })
      ctx.handlers.onAssistantChunk('!', { done: true })
      return { finalText: 'Hello, world!', usage: {}, toolCalls: [], rawMessages: [] }
    }

    const result = await p.execute(baseRequest({ resumeSessionId: 'stream-session-2' }), {}, credential())
    const turns = readTranscriptTurns('fake-agentic-api', result.sessionId!)
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(turns[1]?.text).toBe('Hello, world!')
  })

  test('runConversation throwing mid-stream still flushes the partially-buffered assistant turn', async () => {
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onAssistantChunk('partial thought', { done: false })
      throw new Error('model exploded mid-turn')
    }

    const result = await p.execute(baseRequest({ resumeSessionId: 'stream-session-3' }), {}, credential())
    expect(result.ok).toBe(false)
    const turns = readTranscriptTurns('fake-agentic-api', 'stream-session-3')
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(turns[1]?.text).toBe('partial thought')
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

describe('AgenticApiProvider — AgenticRunError persists partialMessages (Lỗi 1 regression)', () => {
  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-runerror-ws-'))
  })
  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  test('runConversation throwing AgenticRunError persists partialMessages via saveSessionMessages', async () => {
    const p = new FakeAgenticProvider()
    const accumulated = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', tool_calls: [{ id: 'call_1' }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ]
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onToolCall({ name: 'list_directory', argsSummary: '{}', ok: true, resultSummary: '{"ok":true,"entries":[]}' })
      throw new AgenticRunError('gọi LLM thất bại giữa chừng', accumulated)
    }

    const result = await p.execute(baseRequest({ resumeSessionId: 'run-error-session-1' }), {}, credential())

    expect(result.ok).toBe(false)
    expect(result.error).toBe('gọi LLM thất bại giữa chừng')
    expect(loadSessionMessages('run-error-session-1')).toEqual(accumulated)
  })

  test('runConversation throwing a plain Error does not persist any session messages (unlike AgenticRunError)', async () => {
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => {
      throw new Error('model exploded')
    }

    const result = await p.execute(baseRequest({ resumeSessionId: 'run-error-session-2' }), {}, credential())

    expect(result.ok).toBe(false)
    expect(loadSessionMessages('run-error-session-2')).toEqual([])
  })

  test('an AgenticRunError with an empty partialMessages array does not overwrite a previously persisted session', async () => {
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => ({
      finalText: 'ok',
      usage: {},
      toolCalls: [],
      rawMessages: [{ role: 'user', content: 'hello' }],
    })
    const first = await p.execute(baseRequest({ resumeSessionId: 'run-error-session-3' }), {}, credential())
    expect(first.ok).toBe(true)
    const savedAfterSuccess = loadSessionMessages('run-error-session-3')
    expect(savedAfterSuccess).not.toEqual([])

    p.runConversationImpl = async () => {
      throw new AgenticRunError('lỗi không có message nào để lưu', [])
    }
    const second = await p.execute(baseRequest({ resumeSessionId: 'run-error-session-3' }), {}, credential())

    expect(second.ok).toBe(false)
    expect(loadSessionMessages('run-error-session-3')).toEqual(savedAfterSuccess)
  })

  test('resume after a mid-conversation AgenticRunError sees the exact partialMessages, not an empty session', async () => {
    const p = new FakeAgenticProvider()
    const partialMessages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', tool_calls: [{ id: 'call_1' }] },
    ]
    p.runConversationImpl = async () => {
      throw new AgenticRunError('gọi LLM thất bại giữa chừng', partialMessages)
    }

    const first = await p.execute(baseRequest(), {}, credential())
    expect(first.ok).toBe(false)

    let seenPriorMessages: unknown[] = []
    p.runConversationImpl = async (ctx) => {
      seenPriorMessages = ctx.priorMessages
      return { finalText: 'resumed', usage: {}, toolCalls: [], rawMessages: ctx.priorMessages }
    }
    const second = await p.execute(baseRequest({ resumeSessionId: first.sessionId! }), {}, credential())

    expect(second.ok).toBe(true)
    expect(seenPriorMessages).toEqual(partialMessages)
  })
})

describe('AgenticApiProvider — describePayload() không hiển thị model dư từ agent config (Lỗi 2 regression)', () => {
  let logDir: string
  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-payload-ws-'))
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-payload-log-'))
  })
  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(logDir, { recursive: true, force: true })
  })

  test('an agent with an explicit model set does not leak it onto the "Agent:" log line', async () => {
    const logPath = path.join(logDir, 'agent-model.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => ({ finalText: 'ok', usage: {}, toolCalls: [], rawMessages: [] })

    await p.execute(
      baseRequest({
        metadata: { logPath },
        resolvedAgent: { ref: 'agent', name: 'agent', description: '', systemPrompt: 'be helpful', skills: [], model: 'gpt-4o' },
      }),
      {},
      credential(),
    )

    const log = fs.readFileSync(logPath, 'utf8')
    const agentLine = log.split('\n').find((l) => l.startsWith('Agent:'))
    expect(agentLine).toBe('Agent: agent (agent)')
  })

  test('an agent falling back to the system default model still does not show it in the log (TC-05)', async () => {
    const logPath = path.join(logDir, 'agent-default-model.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => ({ finalText: 'ok', usage: {}, toolCalls: [], rawMessages: [] })

    await p.execute(
      baseRequest({
        metadata: { logPath },
        resolvedAgent: { ref: 'agent', name: 'agent', description: '', systemPrompt: 'be helpful', skills: [], model: 'claude-sonnet-4-6' },
      }),
      {},
      credential(),
    )

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).not.toContain('claude-sonnet-4-6')
  })

  test('the real model used to call the API (runnerConfig.model) still shows on the "Provider:" line', async () => {
    const logPath = path.join(logDir, 'provider-model.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => ({ finalText: 'ok', usage: {}, toolCalls: [], rawMessages: [] })

    await p.execute(
      baseRequest({
        metadata: { logPath },
        resolvedAgent: { ref: 'agent', name: 'agent', description: '', systemPrompt: 'be helpful', skills: [], model: 'gpt-4o' },
      }),
      { model: 'gemma-4-26b' },
      credential(),
    )

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toContain('Provider: fake-agentic-api — model: gemma-4-26b')
    expect(log).not.toContain('gpt-4o')
  })
})

describe('AgenticApiProvider — job log (req.metadata.logPath)', () => {
  let logDir: string
  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-log-ws-'))
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-log-'))
  })
  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(logDir, { recursive: true, force: true })
  })

  test('without a logPath, execute() does not throw and writes nothing to disk', async () => {
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => ({ finalText: 'ok', usage: {}, toolCalls: [], rawMessages: [] })
    const result = await p.execute(baseRequest(), {}, credential())
    expect(result.ok).toBe(true)
  })

  test('a successful run writes payload header, tool calls, final text, and a result footer to logPath', async () => {
    const logPath = path.join(logDir, 'success.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => ({
      finalText: 'the final answer',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      toolCalls: [{ name: 'write_file', argsSummary: '{"path":"out.md"}', ok: true, resultSummary: '{"ok":true}' }],
      rawMessages: [],
    })

    const result = await p.execute(baseRequest({ metadata: { logPath } }), { model: 'test-model' }, credential())

    expect(result.ok).toBe(true)
    expect(result.logPath).toBe(logPath)
    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toContain('=== Payload gửi cho runner ===')
    expect(log).toContain('Provider: fake-agentic-api — model: test-model')
    expect(log).toContain('hello') // userPrompt
    expect(log).toContain('[tool] write_file')
    expect(log).toContain('the final answer')
    expect(log).toContain('=== Kết quả ===')
    expect(log).toContain('ok: true')
  })

  test('a missing API key still writes the header and a failing footer to logPath', async () => {
    const logPath = path.join(logDir, 'auth-fail.log')
    const p = new FakeAgenticProvider()
    let called = false
    p.runConversationImpl = async () => {
      called = true
      return { finalText: '', usage: {}, toolCalls: [], rawMessages: [] }
    }

    const result = await p.execute(baseRequest({ metadata: { logPath } }), {}, credential('cli-session'))

    expect(result.ok).toBe(false)
    expect(called).toBe(false)
    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toContain('=== Payload gửi cho runner ===')
    expect(log).toContain('=== Kết quả ===')
    expect(log).toContain('ok: false')
    expect(log).toContain('API key')
  })

  test('runConversation throwing still appends a failing footer to logPath', async () => {
    const logPath = path.join(logDir, 'throw.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async () => {
      throw new Error('model exploded')
    }

    await p.execute(baseRequest({ metadata: { logPath } }), {}, credential())

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toContain('=== Kết quả ===')
    expect(log).toContain('error: model exploded')
  })

  test('onSystemPrompt writes the real system prompt to the job log, before the runner-response marker', async () => {
    const logPath = path.join(logDir, 'system-prompt.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onSystemPrompt('## Tool khả dụng\n...\nbe helpful')
      ctx.handlers.onAssistantChunk('final answer', { done: true })
      return { finalText: 'final answer', usage: {}, toolCalls: [], rawMessages: [] }
    }

    await p.execute(baseRequest({ metadata: { logPath } }), {}, credential())

    const log = fs.readFileSync(logPath, 'utf8')
    const systemIdx = log.indexOf('be helpful')
    const markerIdx = log.indexOf('=== Phản hồi của runner ===')
    const answerIdx = log.indexOf('final answer')
    expect(systemIdx).toBeGreaterThan(-1)
    expect(markerIdx).toBeGreaterThan(systemIdx)
    expect(answerIdx).toBeGreaterThan(markerIdx)
  })

  test('onSystemPrompt is only ever appended once per job, even with multiple tool-call turns', async () => {
    const logPath = path.join(logDir, 'system-prompt-once.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onSystemPrompt('the one true system prompt')
      ctx.handlers.onToolCall({ name: 'search_files', argsSummary: '{}', ok: true, resultSummary: '{"ok":true,"matches":[]}' })
      ctx.handlers.onToolCall({ name: 'search_files', argsSummary: '{}', ok: true, resultSummary: '{"ok":true,"matches":[]}' })
      return { finalText: 'done', usage: {}, toolCalls: [], rawMessages: [] }
    }

    await p.execute(baseRequest({ metadata: { logPath } }), {}, credential())

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log.split('the one true system prompt').length - 1).toBe(1)
  })

  // #225 vấn đề 2: a chat-feedback round resumes the SAME session, so re-printing the
  // whole system prompt in the log every message reads as "system prompt sent again"
  // even though nothing changed. The actual API request must still get the full text —
  // this only gates what gets appended to the log file.
  test('onSystemPrompt gates the log (not the API payload) for a resumed chat-feedback round', async () => {
    const logPath = path.join(logDir, 'system-prompt-resumed.log')
    const p = new FakeAgenticProvider()
    let sentToApi = ''
    p.runConversationImpl = async (ctx) => {
      sentToApi = 'full system prompt text sent to model'
      ctx.handlers.onSystemPrompt(sentToApi)
      return { finalText: 'done', usage: {}, toolCalls: [], rawMessages: [] }
    }

    await p.execute(
      baseRequest({ resumeSessionId: 'sess-1', metadata: { logPath, isChatFeedback: true } }),
      {},
      credential(),
    )

    expect(sentToApi).toBe('full system prompt text sent to model')
    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).not.toContain('full system prompt text sent to model')
    expect(log).toContain('không đổi')
  })

  test('onSystemPrompt logs the full text for the first job of a session (not resumed)', async () => {
    const logPath = path.join(logDir, 'system-prompt-first.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onSystemPrompt('full system prompt text sent to model')
      return { finalText: 'done', usage: {}, toolCalls: [], rawMessages: [] }
    }

    await p.execute(baseRequest({ metadata: { logPath } }), {}, credential())

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toContain('full system prompt text sent to model')
  })

  test('onToolCall logs a success outcome with a distinguishable "ok" marker', async () => {
    const logPath = path.join(logDir, 'tool-ok.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onToolCall({ name: 'search_files', argsSummary: '{"pattern":"needle"}', ok: true, resultSummary: '{"ok":true,"matches":[{"file":"a.ts"}]}' })
      return { finalText: 'done', usage: {}, toolCalls: [], rawMessages: [] }
    }

    await p.execute(baseRequest({ metadata: { logPath } }), {}, credential())

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toContain('[tool] search_files {"pattern":"needle"} → ok')
    expect(log).not.toContain('FAIL')
  })

  test('onToolCall logs a failure outcome with a clear FAIL marker and the error summary', async () => {
    const logPath = path.join(logDir, 'tool-fail.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onToolCall({
        name: 'edit_file',
        argsSummary: '{"path":"a.md"}',
        ok: false,
        resultSummary: '{"ok":false,"error":"old_string not found"}',
      })
      return { finalText: 'done', usage: {}, toolCalls: [], rawMessages: [] }
    }

    await p.execute(baseRequest({ metadata: { logPath } }), {}, credential())

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toContain('[tool] edit_file {"path":"a.md"} → FAIL: {"ok":false,"error":"old_string not found"}')
  })

  test('multiple consecutive tool calls each get their own result line, not a single line repeated with no result', async () => {
    const logPath = path.join(logDir, 'tool-multi.log')
    const p = new FakeAgenticProvider()
    p.runConversationImpl = async (ctx) => {
      ctx.handlers.onSystemPrompt('system prompt')
      for (let i = 0; i < 5; i++) {
        ctx.handlers.onToolCall({ name: 'search_files', argsSummary: `{"pattern":"n${i}"}`, ok: true, resultSummary: '{"ok":true,"matches":[]}' })
      }
      return { finalText: 'done', usage: {}, toolCalls: [], rawMessages: [] }
    }

    await p.execute(baseRequest({ metadata: { logPath } }), {}, credential())

    const log = fs.readFileSync(logPath, 'utf8')
    const lines = log.split('\n').filter((l) => l.startsWith('[tool] search_files'))
    expect(lines).toHaveLength(5)
    for (const line of lines) expect(line).toContain('→ ok')
  })
})

describe('AgenticApiProvider — resolveExtraTools()', () => {
  test('unset/legacy runnerConfig resolves to [] — no behavior change', () => {
    const p = new FakeAgenticProvider()
    expect(p.resolveExtraToolsPublic({})).toEqual([])
    expect(p.resolveExtraToolsPublic({ model: 'x' })).toEqual([])
  })

  test('non-array extraTools is ignored', () => {
    const p = new FakeAgenticProvider()
    expect(p.resolveExtraToolsPublic({ extraTools: 'shell' })).toEqual([])
  })

  test('filters out unknown values, keeps valid ExtraTool entries', () => {
    const p = new FakeAgenticProvider()
    expect(p.resolveExtraToolsPublic({ extraTools: ['shell', 'bogus', 'git'] })).toEqual(['shell', 'git'])
  })
})

describe('AgenticApiProvider — buildToolUsagePreamble()', () => {
  test('lists exactly the tool names passed in, and tells the model to ignore other names', () => {
    const p = new FakeAgenticProvider()
    const text = p.preamble(['read_file', 'run_command'])
    expect(text).toContain('read_file')
    expect(text).toContain('run_command')
    expect(text).not.toContain('git_status')
    expect(text).toMatch(/KHÔNG áp dụng/)
  })

  test('an empty tool list still renders the header without throwing', () => {
    const p = new FakeAgenticProvider()
    expect(() => p.preamble([])).not.toThrow()
  })

  test('tells the model the workspace is already the task folder — no path prefix', () => {
    const p = new FakeAgenticProvider()
    const text = p.preamble(['write_file'])
    expect(text).toMatch(/workspace hiện tại CHÍNH LÀ thư mục task/)
    expect(text).toContain('`qa.md`')
    expect(text).toContain('.dev-team-agent/tasks/<task-id>/qa.md')
  })
})

describe('AgenticApiProvider — buildProjectContextPreamble()', () => {
  let projectRoot: string
  let devTeamRoot: string

  beforeAll(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-project-'))
    devTeamRoot = path.join(projectRoot, '.dev-team-agent')
    fs.mkdirSync(devTeamRoot, { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# AGENTS\n\nbat bien quan trong')
    fs.writeFileSync(path.join(devTeamRoot, 'project-rules.md'), '# Rules\n\nrule coding')
  })
  afterAll(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  })

  test('embeds AGENTS.md and project-rules.md content when metadata points at them', () => {
    const p = new FakeAgenticProvider()
    const text = p.projectContextPreamble(baseRequest({ metadata: { projectRoot, devTeamRoot } }))
    expect(text).toContain('bat bien quan trong')
    expect(text).toContain('rule coding')
    expect(text).toMatch(/KHÔNG gọi tool để đọc lại/)
  })

  test('returns empty string when metadata has no projectRoot/devTeamRoot', () => {
    const p = new FakeAgenticProvider()
    expect(p.projectContextPreamble(baseRequest())).toBe('')
  })

  test('returns empty string instead of throwing when the files do not exist', () => {
    const p = new FakeAgenticProvider()
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-empty-'))
    expect(p.projectContextPreamble(baseRequest({ metadata: { projectRoot: emptyDir, devTeamRoot: emptyDir } }))).toBe('')
    fs.rmSync(emptyDir, { recursive: true, force: true })
  })
})

describe('AgenticApiProvider — runShellCommand() (run_command)', () => {
  // Dedicated workspace — the shared `workspace` var is mutated/torn down by
  // other describe blocks' own beforeAll/afterAll, so it isn't safe to reuse here.
  let shellWs: string
  beforeAll(() => {
    shellWs = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-shell-'))
  })
  afterAll(() => {
    fs.rmSync(shellWs, { recursive: true, force: true })
  })

  test('rejects a binary outside the allowlist without spawning anything', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.runCmd(shellWs, 'rm', ['-rf', '/'])
    expect(result.ok).toBe(false)
    expect(result.error).toContain('không nằm trong allowlist')
  })

  test('runs an allowlisted binary and captures stdout/exit code', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.runCmd(shellWs, 'bun', ['-e', "console.log('hello-from-node')"])
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello-from-node')
  })

  test('a non-zero exit is reported as ok:false with captured stderr, not thrown', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.runCmd(shellWs, 'bun', ['-e', 'process.exit(3)'])
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(3)
  })

  test('a shell metacharacter passed as a single argv entry is not interpreted by a shell', () => {
    const p = new FakeAgenticProvider()
    const marker = path.join(shellWs, 'should-not-exist.txt')
    // argv-array spawn (no shell:true) — this whole string is one literal
    // argument to `bun -e`, never reaches an actual shell for `;`/`&&` to split on.
    const result: any = p.runCmd(shellWs, 'bun', ['-e', `console.log(process.argv[1])`, `; touch ${marker}`])
    expect(result.ok).toBe(true)
    expect(fs.existsSync(marker)).toBe(false)
  })

  test('cwd is always the workspace, not escapable via args', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.runCmd(shellWs, 'bun', ['-e', 'console.log(process.cwd())'])
    expect(result.stdout.trim()).toBe(fs.realpathSync(shellWs))
  })
})

describe('AgenticApiProvider — git tools (read-only)', () => {
  let repo: string
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-git-'))
    execSync('git init -q', { cwd: repo })
    execSync('git config user.email test@example.com', { cwd: repo })
    execSync('git config user.name test', { cwd: repo })
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n')
    execSync('git add a.txt', { cwd: repo })
    execSync('git commit -q -m "first commit"', { cwd: repo })
  })
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  test('gitStatus reports a clean tree, then a dirty one after an edit', () => {
    const p = new FakeAgenticProvider()
    expect((p.gitStatusPublic(repo) as any).stdout.trim()).toBe('')
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n')
    expect((p.gitStatusPublic(repo) as any).stdout).toContain('a.txt')
    execSync('git checkout -- a.txt', { cwd: repo })
  })

  test('gitDiff shows the working-tree diff for an edited file', () => {
    const p = new FakeAgenticProvider()
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nthree\n')
    const result: any = p.gitDiffPublic(repo, 'a.txt')
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('a.txt')
    execSync('git checkout -- a.txt', { cwd: repo })
  })

  test('gitLog lists the commit history, capped to a sane max', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.gitLogPublic(repo, 500)
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('first commit')
  })

  test('running against a directory that is not a git repo fails structurally, not by throwing', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.gitStatusPublic(workspace)
    expect(result.ok).toBe(false)
  })
})

describe('AgenticApiProvider — searchFiles() (search_files)', () => {
  let searchWs: string
  beforeAll(() => {
    searchWs = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agentic-search-'))
    fs.mkdirSync(path.join(searchWs, 'src'), { recursive: true })
    fs.mkdirSync(path.join(searchWs, 'node_modules', 'dep'), { recursive: true })
    fs.writeFileSync(path.join(searchWs, 'src', 'a.ts'), 'const needle = 1\nconst other = 2\n')
    fs.writeFileSync(path.join(searchWs, 'src', 'b.ts'), 'no match here\n')
    fs.writeFileSync(path.join(searchWs, 'node_modules', 'dep', 'c.ts'), 'const needle = 999\n')
  })
  afterAll(() => {
    fs.rmSync(searchWs, { recursive: true, force: true })
  })

  test('finds a literal substring match with file/line/text', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.searchFilesPublic(searchWs, 'needle')
    expect(result.ok).toBe(true)
    expect(result.matches).toEqual([{ file: path.join('src', 'a.ts'), line: 1, text: 'const needle = 1' }])
  })

  test('node_modules is excluded from the search', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.searchFilesPublic(searchWs, 'needle')
    expect(result.matches.some((m: any) => m.file.includes('node_modules'))).toBe(false)
  })

  test('a path outside the workspace is rejected', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.searchFilesPublic(searchWs, 'needle', '../../etc')
    expect(result.ok).toBe(false)
  })

  test('an empty pattern is rejected with a clear error', () => {
    const p = new FakeAgenticProvider()
    const result: any = p.searchFilesPublic(searchWs, '')
    expect(result.ok).toBe(false)
  })
})

describe('AgenticApiProvider — webSearch() / fetchUrl()', () => {
  const originalFetch = globalThis.fetch
  const savedKey = process.env.BRAVE_SEARCH_API_KEY
  afterEach(() => {
    globalThis.fetch = originalFetch
    if (savedKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY
    else process.env.BRAVE_SEARCH_API_KEY = savedKey
  })

  test('isWebSearchConfigured() reflects BRAVE_SEARCH_API_KEY presence', () => {
    const p = new FakeAgenticProvider()
    delete process.env.BRAVE_SEARCH_API_KEY
    expect(p.isWebSearchConfiguredPublic()).toBe(false)
    process.env.BRAVE_SEARCH_API_KEY = 'brave-test-key'
    expect(p.isWebSearchConfiguredPublic()).toBe(true)
  })

  test('webSearch without a configured key fails without making any request', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}')
    }) as unknown as typeof fetch
    const p = new FakeAgenticProvider()
    const result: any = await p.webSearchPublic('anything')
    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })

  test('webSearch sends the subscription token header and maps results', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'brave-test-key'
    let seenHeaders: Headers | undefined
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers)
      return new Response(
        JSON.stringify({ web: { results: [{ title: 'T', url: 'https://example.test/x', description: 'D' }] } }),
      )
    }) as unknown as typeof fetch

    const p = new FakeAgenticProvider()
    const result: any = await p.webSearchPublic('query')
    expect(seenHeaders?.get('x-subscription-token')).toBe('brave-test-key')
    expect(result.ok).toBe(true)
    expect(result.results).toEqual([{ title: 'T', url: 'https://example.test/x', snippet: 'D' }])
  })

  test('fetchUrl delegates SSRF guarding to fetchUrlSafe — http:// is rejected', async () => {
    const p = new FakeAgenticProvider()
    const result: any = await p.fetchUrlPublic('http://example.test')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/https/)
  })

  test('fetchUrl delegates SSRF guarding to fetchUrlSafe — private hosts are rejected', async () => {
    const p = new FakeAgenticProvider()
    const result: any = await p.fetchUrlPublic('https://localhost/secret')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/private/)
  })

  test('fetchUrl returns the fetched content on success', async () => {
    globalThis.fetch = (async () => new Response('page content')) as unknown as typeof fetch
    const p = new FakeAgenticProvider()
    const result: any = await p.fetchUrlPublic('https://example.test/page')
    expect(result.ok).toBe(true)
    expect(result.content).toBe('page content')
  })
})
