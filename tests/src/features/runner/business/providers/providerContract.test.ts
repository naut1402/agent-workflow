import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  agentTranscriptFile,
  getProvider,
  listAvailableModels,
  listProviderCatalog,
  loadJob,
  providerDescriptorOf,
  providerFamilyOf,
  registerProvider,
  resolveProviderApiKey,
  scanLocalCommands,
  setDefaultRunner,
  submitJob,
  transcriptFormatOf,
  upsertConnection,
  upsertRunner,
} from '../../../../../../src/features/runner/business/index.js'
import {
  AgenticApiProvider,
  type AgenticCompletionContext,
  type AgenticRunResult,
} from '../../../../../../src/features/runner/business/providers/AgenticApiProvider.js'
import { appendTranscriptTurn } from '../../../../../../src/features/runner/business/providers/agentTranscriptStore.js'
import { NoMcpDelivery } from '../../../../../../src/features/runner/business/mcpDelivery/NoMcpDelivery.js'
import { OpenAiCompatibleProvider } from '../../../../../../src/features/runner/business/providers/OpenAiCompatibleProvider.js'
import { registryHome } from '../../../../../../src/backend/registry.js'
import type {
  CredentialProfile,
  ExecuteResult,
  RunnerProvider,
  UsageCaptureInput,
} from '../../../../../../src/features/runner/business/types.js'

// #440 · Tfb77cf90-P1 — hợp đồng `RunnerProvider` + chỗ lắp ráp `providerRegistry.ts`.
// Khoá hành vi nơi gọi trước đây rẽ nhánh theo `providerId`, và các hook mở cho
// #441 (transcript), #445 (usage), #448 (một lượt).

let home: string
let workspace: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-contract-'))
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-contract-ws-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(workspace, { recursive: true, force: true })
})

function stub(providerId: string, extra: Partial<RunnerProvider> = {}): RunnerProvider {
  return {
    providerId,
    validateRunnerConfig: () => ({ ok: true, errors: [] }),
    validateCredential: () => ({ ok: true, errors: [] }),
    capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
    execute: async (): Promise<ExecuteResult> => ({ ok: true, exitCode: 0, durationMs: 1 }),
    ...extra,
  }
}

/** Thay provider dựng sẵn trong một ca rồi trả lại đúng instance cũ. */
async function withReplaced(providerId: string, replacement: RunnerProvider, fn: () => void | Promise<void>) {
  const original = getProvider(providerId)!
  registerProvider(replacement)
  try {
    await fn()
  } finally {
    registerProvider(original)
  }
}

describe('transcriptFormatOf — hook transcript cho #441', () => {
  test('provider dựng sẵn khai định dạng transcript của mình', () => {
    expect(transcriptFormatOf('claude-code-cli')).toBe('claude-projects')
    expect(transcriptFormatOf('cursor-cli')).toBe('cursor-projects')
    expect(transcriptFormatOf('codex-cli')).toBe('none')
    expect(transcriptFormatOf('console-command')).toBe('none')
    for (const id of ['anthropic-api', 'openai-api', 'gemini-api', 'xai-api']) {
      expect(transcriptFormatOf(id)).toBe('agent-sdk')
    }
  })

  test('cùng thứ tự fallback với providerFamilyOf: dựng sẵn → provider đang chạy → luật theo id', () => {
    // Provider lạ chưa đăng ký: họ `ai-api` (đuôi `-api`) ⇒ runner tự ghi transcript.
    expect(transcriptFormatOf('p1-chua-dang-ky-api')).toBe('agent-sdk')
    expect(transcriptFormatOf('p1-chua-dang-ky')).toBe('none')
    expect(transcriptFormatOf('')).toBe('none')

    registerProvider(stub('p1-tu-khai-transcript', { transcriptFormat: 'cursor-projects' }))
    expect(transcriptFormatOf('p1-tu-khai-transcript')).toBe('cursor-projects')
  })

  test('stub thay provider dựng sẵn vẫn giữ định dạng của bản dựng sẵn', async () => {
    await withReplaced('claude-code-cli', stub('claude-code-cli'), () => {
      expect(transcriptFormatOf('claude-code-cli')).toBe('claude-projects')
      expect(getProvider('claude-code-cli')!.transcriptFormat).toBe('claude-projects')
    })
  })
})

describe('agentTranscriptFile — path transcript phiên provider API', () => {
  test('trỏ đúng file appendTranscriptTurn ghi', () => {
    const file = agentTranscriptFile('openai-api', 'sess-p1')
    expect(file).toBe(path.join(registryHome(), 'agent-sdk-transcripts', 'openai-api', 'sess-p1.jsonl'))
    appendTranscriptTurn('openai-api', 'sess-p1', { role: 'user', text: 'xin chào' })
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(JSON.parse(lines[0])).toMatchObject({ role: 'user', text: 'xin chào' })
  })
})

describe('registerProvider — bù trường stub không khai', () => {
  test('id lạ: family theo luật id, chạy agent, Null Object MCP, không vào catalog', () => {
    registerProvider(stub('p1-stub-la'))
    const p = getProvider('p1-stub-la')!
    expect(p.family).toBe('console-command')
    expect(p.acceptsAgent).toBe(true)
    expect(p.mcpDelivery).toBeInstanceOf(NoMcpDelivery)
    expect(p.mcpDelivery.acceptsSelfServer).toBe(false)
    expect(listProviderCatalog().some((e) => e.id === 'p1-stub-la')).toBe(false)

    registerProvider(stub('p1-stub-la-api'))
    expect(getProvider('p1-stub-la-api')!.family).toBe('ai-api')
  })

  test('🚫 ghi giá trị bù lên object gốc — stub chép từ stub khác không mang family cũ', () => {
    const first = stub('p1-spread-api')
    registerProvider(first)
    expect(getProvider('p1-spread-api')!.family).toBe('ai-api')
    expect(first.family).toBeUndefined()
    registerProvider({ ...first, providerId: 'p1-spread-shell' })
    expect(getProvider('p1-spread-shell')!.family).toBe('console-command')
  })

  test('trường stub tự khai được giữ nguyên', () => {
    registerProvider(stub('p1-stub-khai', { family: 'ai-api', acceptsAgent: false }))
    const p = getProvider('p1-stub-khai')!
    expect(p.family).toBe('ai-api')
    expect(p.acceptsAgent).toBe(false)
    expect(providerFamilyOf('p1-stub-khai')).toBe('ai-api')
  })

  test('stub thay `claude-code-cli`: kế thừa captureUsage + model tĩnh của bản dựng sẵn', async () => {
    await withReplaced('claude-code-cli', stub('claude-code-cli'), async () => {
      const p = getProvider('claude-code-cli')!
      expect(p.family).toBe('agent-cli')
      expect(p.acceptsAgent).toBe(true)
      expect(typeof p.captureUsage).toBe('function')
      expect(await listAvailableModels({ providerId: 'claude-code-cli' })).toEqual({
        ok: true,
        models: ['opus', 'sonnet', 'haiku'],
      })
      // Catalog vẫn liệt kê, nhưng cách giao MCP là của stub đang chạy.
      expect(listProviderCatalog().find((e) => e.id === 'claude-code-cli')!.mcpDelivery).toBe('unsupported')
    })
  })

  test('stub thay `console-command`: vẫn không chạy agent', async () => {
    await withReplaced('console-command', stub('console-command'), () => {
      expect(getProvider('console-command')!.acceptsAgent).toBe(false)
      expect(getProvider('console-command')!.family).toBe('console-command')
    })
  })

  test('stub thay provider API: 🚫 kế thừa listModels (danh sách phải tự gọi endpoint)', async () => {
    await withReplaced('openai-api', stub('openai-api'), async () => {
      expect(getProvider('openai-api')!.listModels).toBeUndefined()
      expect(await listAvailableModels({ providerId: 'openai-api', secretValue: 'sk-x' })).toEqual({
        ok: false,
        error: 'provider này không hỗ trợ liệt kê model',
      })
    })
  })
})

describe('listProviderCatalog — ProviderDescriptor thay bảng theo id ở FE', () => {
  test('thứ tự + family giữ nguyên', () => {
    const catalog = listProviderCatalog()
    expect(catalog.map((e) => [e.id, e.kind, e.family])).toEqual([
      ['claude-code-cli', 'local-console', 'agent-cli'],
      ['cursor-cli', 'local-console', 'agent-cli'],
      ['codex-cli', 'local-console', 'agent-cli'],
      ['console-command', 'local-console', 'console-command'],
      ['anthropic-api', 'ai-provider', 'ai-api'],
      ['openai-api', 'ai-provider', 'ai-api'],
      ['gemini-api', 'ai-provider', 'ai-api'],
      ['xai-api', 'ai-provider', 'ai-api'],
    ])
  })

  test('năng lực UI khai ở provider (H5 · H7 · H8)', () => {
    const by = Object.fromEntries(listProviderCatalog().map((e) => [e.id, e]))
    expect(by['claude-code-cli']).toMatchObject({
      label: 'Claude Code CLI',
      acceptsAgent: true,
      modelListing: 'static',
      supportsAllowedTools: true,
      localCommand: { id: 'claude', command: 'claude' },
    })
    expect(by['cursor-cli']).toMatchObject({ modelListing: 'none', localCommand: { id: 'cursor', command: 'agent' } })
    expect(by['cursor-cli'].supportsAllowedTools).toBeUndefined()
    expect(by['codex-cli']).toMatchObject({ modelListing: 'none', localCommand: { id: 'codex', command: 'codex' } })
    expect(by['console-command']).toMatchObject({ acceptsAgent: false, modelListing: 'none' })
    expect(by['console-command'].localCommand).toBeUndefined()
  })

  test('base URL + gợi ý model / secretRef của 4 provider API (H6)', () => {
    const by = Object.fromEntries(listProviderCatalog().map((e) => [e.id, e]))
    expect(by['openai-api']).toMatchObject({
      label: 'OpenAI API',
      modelListing: 'api',
      defaultBaseURL: 'https://api.openai.com/v1',
      modelHint: 'gpt-4.1',
      secretEnvHint: 'env:OPENAI_API_KEY',
    })
    expect(by['gemini-api']).toMatchObject({
      defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      modelHint: 'gemini-2.5-pro',
      secretEnvHint: 'env:GEMINI_API_KEY',
    })
    expect(by['xai-api']).toMatchObject({ defaultBaseURL: 'https://api.x.ai/v1', modelHint: 'grok-4', secretEnvHint: 'env:XAI_API_KEY' })
    expect(by['anthropic-api']).toMatchObject({
      defaultBaseURL: 'https://api.anthropic.com',
      modelHint: 'claude-opus-4-6',
      secretEnvHint: 'env:ANTHROPIC_API_KEY',
    })
  })

  test('providerDescriptorOf + scanLocalCommands đọc cùng catalog', () => {
    expect(providerDescriptorOf('codex-cli')?.label).toBe('Codex CLI')
    expect(providerDescriptorOf('khong-ton-tai')).toBeNull()
    const builtin = scanLocalCommands().filter((c) => !c.custom)
    expect(builtin.map((c) => [c.id, c.command, c.providerId])).toEqual([
      ['claude', 'claude', 'claude-code-cli'],
      ['cursor', 'agent', 'cursor-cli'],
      ['codex', 'codex', 'codex-cli'],
    ])
  })
})

describe('setDefaultRunner — chặn provider không chạy agent (registry.ts, giữ hành vi)', () => {
  beforeEach(() => {
    for (const f of ['runners.json', 'connections.json']) fs.rmSync(path.join(home, f), { force: true })
  })

  test('connection console-command ⇒ 400 nguyên văn', () => {
    upsertConnection({ id: 'p1-conn-sh', kind: 'local-console', providerId: 'console-command', cliPath: 'sh' })
    upsertRunner({ id: 'p1-sh', connectionId: 'p1-conn-sh', config: {} })
    expect(setDefaultRunner('p1-sh')).toEqual({
      ok: false,
      status: 400,
      error: 'console-command cannot be the default AI runner; pick an Agent CLI connection',
    })
  })

  test('connection trỏ provider chưa đăng ký ⇒ vẫn đặt được (khác defaultRunnerIssueOf)', () => {
    upsertConnection({ id: 'p1-conn-ghost', kind: 'local-console', providerId: 'p1-ghost-provider', cliPath: 'x' })
    upsertRunner({ id: 'p1-ghost', connectionId: 'p1-conn-ghost', config: {} })
    expect(setDefaultRunner('p1-ghost')).toEqual({ ok: true, defaultRunnerId: 'p1-ghost' })
  })
})

describe('jobQueue — gọi hook thay vì so providerId', () => {
  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
  }
  async function settle(id: string) {
    for (let i = 0; i < 400; i++) {
      const j = loadJob(id)
      if (j && j.status !== 'queued' && j.status !== 'running') return j
      await sleep(5)
    }
    throw new Error(`job ${id} never settled`)
  }
  function seed(providerId: string) {
    upsertConnection({ id: `conn-${providerId}`, kind: 'local-console', providerId, cliPath: 'stub' })
    upsertRunner({ id: `run-${providerId}`, connectionId: `conn-${providerId}`, config: {} })
    return `run-${providerId}`
  }

  test('acceptsAgent: false ⇒ bỏ qua agentRef (không đi tìm file agent)', async () => {
    registerProvider(stub('p1-no-agent', { acceptsAgent: false }))
    const job = submitJob({ runnerId: seed('p1-no-agent'), agentRef: 'agent-khong-ton-tai', workspace, userPrompt: 'x' })
    expect((await settle(job.id)).status).toBe('succeeded')
  })

  test('acceptsAgent mặc định ⇒ agentRef hỏng làm job fail như trước', async () => {
    registerProvider(stub('p1-with-agent'))
    const job = submitJob({ runnerId: seed('p1-with-agent'), agentRef: 'agent-khong-ton-tai', workspace, userPrompt: 'x' })
    const done = await settle(job.id)
    expect(done.status).toBe('failed')
    expect(done.error).toContain('agent file not found for ref: agent-khong-ton-tai')
  })

  test('captureUsage được gọi với session id của job; provider không khai thì thôi', async () => {
    const calls: UsageCaptureInput[] = []
    registerProvider(
      stub('p1-usage', {
        execute: async () => ({ ok: true, exitCode: 0, durationMs: 1, sessionId: 'sess-usage-1' }),
        captureUsage: async (input) => {
          calls.push(input)
        },
      }),
    )
    const job = submitJob({ runnerId: seed('p1-usage'), agentRef: '', workspace, userPrompt: 'x' })
    await settle(job.id)
    await sleep(20)
    expect(calls).toHaveLength(1)
    expect(calls[0].sessionId).toBe('sess-usage-1')
    expect(calls[0].job.id).toBe(job.id)
    expect(calls[0].job.sessionId).toBe('sess-usage-1')
  })
})

describe('complete() — hook một lượt cho #448', () => {
  class OneShotProvider extends AgenticApiProvider {
    readonly providerId = 'p1-oneshot-api'
    seen: AgenticCompletionContext | null = null
    protected async runConversation(): Promise<AgenticRunResult> {
      return { finalText: '', usage: {}, toolCalls: [], rawMessages: [] }
    }
    protected override async completeOnce(ctx: AgenticCompletionContext) {
      this.seen = ctx
      return { text: `trả lời: ${ctx.prompt}`, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }
    }
  }
  class NoOneShotProvider extends AgenticApiProvider {
    readonly providerId = 'p1-no-oneshot-api'
    protected async runConversation(): Promise<AgenticRunResult> {
      return { finalText: '', usage: {}, toolCalls: [], rawMessages: [] }
    }
  }
  const envCred = (name: string): CredentialProfile => ({ id: 'c', provider: 'x', label: 'x', secretRef: `env:${name}` })

  test('key từ credential, model / baseURL từ cấu hình Connection', async () => {
    process.env.P1_ONESHOT_KEY = 'sk-oneshot'
    const p = new OneShotProvider()
    const out = await p.complete({ prompt: 'hỏi', system: 'sys', maxTokens: 50 }, { model: 'm-1', baseURL: 'https://x.test' }, envCred('P1_ONESHOT_KEY'))
    expect(out).toEqual({ ok: true, text: 'trả lời: hỏi', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } })
    expect(p.seen).toMatchObject({ apiKey: 'sk-oneshot', model: 'm-1', baseURL: 'https://x.test', system: 'sys', maxTokens: 50 })
  })

  test('thiếu key ⇒ lỗi cùng chữ với execute()', async () => {
    delete process.env.P1_ONESHOT_MISSING
    const out = await new OneShotProvider().complete({ prompt: 'hỏi' }, {}, envCred('P1_ONESHOT_MISSING'))
    expect(out).toEqual({ ok: false, error: 'missing API key — biến môi trường "P1_ONESHOT_MISSING" chưa được đặt' })
  })

  test('hiện thực không override completeOnce ⇒ lỗi rõ, không ném', async () => {
    process.env.P1_ONESHOT_KEY = 'sk-oneshot'
    const out = await new NoOneShotProvider().complete({ prompt: 'hỏi' }, {}, envCred('P1_ONESHOT_KEY'))
    expect(out).toEqual({ ok: false, error: 'provider này không hỗ trợ gọi một lượt' })
  })

  test('OpenAiCompatibleProvider: một request chat, không tool', async () => {
    process.env.P1_ONESHOT_KEY = 'sk-oneshot'
    const originalFetch = globalThis.fetch
    let body: any = null
    let url = ''
    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      url = String(u)
      body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-test',
          choices: [{ index: 0, message: { role: 'assistant', content: 'xin chào' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
    try {
      const p = new OpenAiCompatibleProvider('openai-api', 'https://api.openai.test/v1')
      const out = await p.complete({ prompt: 'chào', system: 'ngắn gọn' }, { model: 'gpt-test' }, envCred('P1_ONESHOT_KEY'))
      expect(out).toEqual({ ok: true, text: 'xin chào', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } })
      expect(url).toBe('https://api.openai.test/v1/chat/completions')
      expect(body.model).toBe('gpt-test')
      expect(body.tools).toBeUndefined()
      expect(body.messages).toEqual([
        { role: 'system', content: 'ngắn gọn' },
        { role: 'user', content: 'chào' },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('provider CLI không có hook một lượt', () => {
    expect(getProvider('claude-code-cli')!.complete).toBeUndefined()
    expect(typeof getProvider('anthropic-api')!.complete).toBe('function')
  })
})

describe('resolveProviderApiKey — thông điệp nguyên văn', () => {
  test('env có giá trị ⇒ key', async () => {
    process.env.P1_KEY_OK = 'sk-ok'
    expect(await resolveProviderApiKey({ id: 'c', provider: 'x', label: 'x', secretRef: 'env:P1_KEY_OK' }, 'openai-api')).toEqual({
      ok: true,
      value: 'sk-ok',
    })
  })

  test('secretRef không hỗ trợ cho API provider', async () => {
    expect(await resolveProviderApiKey({ id: 'c', provider: 'x', label: 'x', secretRef: 'cli-session' }, 'openai-api')).toEqual({
      ok: false,
      error: 'missing API key — secretRef "cli-session" không hỗ trợ cho API provider',
    })
  })

  test('stored khi chưa đặt DASHBOARD_SECRET_KEY', async () => {
    const prev = process.env.DASHBOARD_SECRET_KEY
    delete process.env.DASHBOARD_SECRET_KEY
    try {
      expect(await resolveProviderApiKey({ id: 'c', provider: 'x', label: 'x', secretRef: 'stored:khong-co' }, 'openai-api')).toEqual({
        ok: false,
        error: 'missing API key — DASHBOARD_SECRET_KEY chưa được đặt — không thể đọc secret từ vault',
      })
    } finally {
      if (prev !== undefined) process.env.DASHBOARD_SECRET_KEY = prev
    }
  })
})
