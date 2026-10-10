import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { AnthropicDraftGenerator } from '../../../../../src/features/agent-editor/business/generators/AnthropicDraftGenerator'
import { HeuristicDraftGenerator } from '../../../../../src/features/agent-editor/business/generators/HeuristicDraftGenerator'
import { emptyDraft, heuristicDraftFromDescription } from '../../../../../src/features/agent-editor/business/agentMarkdown.js'

// Hợp đồng DraftGenerator (#448): hiện thực trả `null` khi không sinh được để
// chỗ lắp ráp chuyển sang generator kế tiếp; không ném lỗi ra ngoài.

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

function stubFetch(respond: () => Response): { count: number } {
  const state = { count: 0 }
  globalThis.fetch = (async () => {
    state.count++
    return respond()
  }) as unknown as typeof fetch
  return state
}

const reply = (text: string, status = 200) =>
  new Response(JSON.stringify({ content: [{ text }] }), { status })

describe('HeuristicDraftGenerator', () => {
  test('always returns the heuristic draft, never null', async () => {
    const gen = new HeuristicDraftGenerator()
    expect(await gen.generate('agent thiết kế')).toEqual(heuristicDraftFromDescription('agent thiết kế'))
    expect(await gen.generate('')).toEqual(heuristicDraftFromDescription(''))
  })
})

describe('AnthropicDraftGenerator', () => {
  const gen = new AnthropicDraftGenerator()

  test('returns null without calling the network when the key is missing', async () => {
    const f = stubFetch(() => reply('{"name":"x"}'))
    expect(await gen.generate('mô tả')).toBeNull()
    expect(f.count).toBe(0)
  })

  test('returns null without calling the network when the description is blank', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'
    const f = stubFetch(() => reply('{"name":"x"}'))
    expect(await gen.generate('  ')).toBeNull()
    expect(f.count).toBe(0)
  })

  test('returns null on HTTP error, missing JSON, or a thrown error', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'
    stubFetch(() => reply('{"name":"x"}', 429))
    expect(await gen.generate('mô tả')).toBeNull()
    stubFetch(() => reply('no json'))
    expect(await gen.generate('mô tả')).toBeNull()
    stubFetch(() => { throw new Error('boom') })
    expect(await gen.generate('mô tả')).toBeNull()
  })

  test('returns the parsed draft merged over emptyDraft()', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'
    stubFetch(() => reply('{"name":"x","sections":{"role":"R"}}'))
    const draft = await gen.generate('mô tả')
    expect(draft).toEqual({ ...emptyDraft(), name: 'x', sections: { ...emptyDraft().sections, role: 'R' } })
  })
})
