import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { generateDraftFromNl } from '../../../server/agents/generate'

// With no API key, generateDraftFromNl must fall back to the local heuristic
// (deterministic, no network).
let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
})
afterEach(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey
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
