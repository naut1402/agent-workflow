import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { generateDraftFromNl } from '../../../../src/features/agent-editor/business/generate'
import { emptyDraft, heuristicDraftFromDescription } from '../../../../src/features/agent-editor/business/agentMarkdown.js'

// With no API key, generateDraftFromNl must fall back to the local heuristic
// (deterministic, no network).
let savedKey: string | undefined
const realFetch = globalThis.fetch

beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
})
afterEach(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey
  else delete process.env.ANTHROPIC_API_KEY
  globalThis.fetch = realFetch
})

describe('generateDraftFromNl (heuristic fallback)', () => {
  test('returns a draft with sections from the description', async () => {
    const draft = await generateDraftFromNl('Một agent điều tra codebase')
    expect(draft).toBeTruthy()
    expect(draft.sections).toBeTruthy()
    expect(typeof draft.sections.role).toBe('string')
  })
  test('handles an empty description without throwing', async () => {
    const draft = await generateDraftFromNl('')
    expect(draft.sections).toBeTruthy()
  })
})

// ── Nhánh Anthropic API (characterization — #448) ───────────────────────────
// Giữ nguyên văn: env, URL, header, model, max_tokens, prompt, timeout và
// 4 lối rơi về heuristic (không key / mô tả rỗng · HTTP lỗi · không thấy JSON · ném lỗi).

interface FetchCall { url: string; init: RequestInit }

function stubFetch(respond: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return calls
}

function anthropicReply(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const DESC = 'Một agent review code'

describe('generateDraftFromNl (Anthropic API branch)', () => {
  test('sends the hard-coded Messages API request when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    const calls = stubFetch(() => anthropicReply('{"name":"x"}'))
    await generateDraftFromNl(DESC)

    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'sk-test-key',
      'anthropic-version': '2023-06-01',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Tạo JSON AgentDraft cho agent Claude Code từ mô tả sau. Trả về CHỈ JSON hợp lệ với keys: name, description, model, skills (array), parameters (array of {name, description}), sections (object role/skills/workflow/guardrail/output), section_order.\n\nMô tả: ${DESC}`,
      }],
    })
  })

  test('merges the parsed JSON over emptyDraft(), sections merged one level deep', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    const parsed = {
      name: 'reviewer-x',
      skills: ['coding-rules'],
      sections: { role: 'Reviewer', workflow: '1. Đọc diff' },
      extra_field: 42,
    }
    stubFetch(() => anthropicReply(`Đây là JSON:\n${JSON.stringify(parsed)}\nHết.`))
    const draft = await generateDraftFromNl(DESC)

    const base = emptyDraft()
    expect(draft).toEqual({
      ...base,
      ...parsed,
      sections: { ...base.sections, ...parsed.sections },
    })
  })

  test('model output is merged as-is (no schema validation)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    stubFetch(() => anthropicReply('{"model":"whatever","section_order":["role"]}'))
    const draft = await generateDraftFromNl(DESC)
    expect(draft.model).toBe('whatever')
    expect(draft.section_order).toEqual(['role'])
    expect(draft.sections).toEqual(emptyDraft().sections)
  })

  test('lối 1a — no API key: no network call, heuristic draft', async () => {
    const calls = stubFetch(() => anthropicReply('{"name":"x"}'))
    const draft = await generateDraftFromNl(DESC)
    expect(calls).toHaveLength(0)
    expect(draft).toEqual(heuristicDraftFromDescription(DESC))
  })

  test('lối 1b — blank description with key: no network call, heuristic draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    const calls = stubFetch(() => anthropicReply('{"name":"x"}'))
    const draft = await generateDraftFromNl('   ')
    expect(calls).toHaveLength(0)
    expect(draft).toEqual(heuristicDraftFromDescription('   '))
  })

  test('lối 2 — HTTP error: heuristic draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    const calls = stubFetch(() => anthropicReply('{"name":"x"}', 500))
    const draft = await generateDraftFromNl(DESC)
    expect(calls).toHaveLength(1)
    expect(draft).toEqual(heuristicDraftFromDescription(DESC))
  })

  test('lối 3 — reply without JSON object: heuristic draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    stubFetch(() => anthropicReply('không có json ở đây'))
    expect(await generateDraftFromNl(DESC)).toEqual(heuristicDraftFromDescription(DESC))
  })

  test('lối 3 — reply without content: heuristic draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    stubFetch(() => new Response('{}', { status: 200 }))
    expect(await generateDraftFromNl(DESC)).toEqual(heuristicDraftFromDescription(DESC))
  })

  test('lối 4 — fetch throws: heuristic draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    stubFetch(() => { throw new Error('network down') })
    expect(await generateDraftFromNl(DESC)).toEqual(heuristicDraftFromDescription(DESC))
  })

  test('lối 4 — malformed JSON between braces: heuristic draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    stubFetch(() => anthropicReply('{ name: not-json }'))
    expect(await generateDraftFromNl(DESC)).toEqual(heuristicDraftFromDescription(DESC))
  })

  test('lối 4 — response body is not JSON: heuristic draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    stubFetch(() => new Response('<html>oops</html>', { status: 200 }))
    expect(await generateDraftFromNl(DESC)).toEqual(heuristicDraftFromDescription(DESC))
  })
})
