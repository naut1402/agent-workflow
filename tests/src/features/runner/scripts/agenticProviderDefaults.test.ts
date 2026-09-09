import { describe, expect, test } from 'vitest'
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODEL_HINTS,
  DEFAULT_SECRET_ENV_HINTS,
} from '../../../../../src/features/runner/scripts/agenticProviderDefaults'

const AGENTIC_API_PROVIDER_IDS = ['openai-api', 'gemini-api', 'xai-api', 'anthropic-api']

describe('agenticProviderDefaults', () => {
  test('every API-based agentic provider has an entry in all 3 hint maps', () => {
    for (const id of AGENTIC_API_PROVIDER_IDS) {
      expect(DEFAULT_BASE_URLS[id]).toBeTruthy()
      expect(DEFAULT_MODEL_HINTS[id]).toBeTruthy()
      expect(DEFAULT_SECRET_ENV_HINTS[id]).toBeTruthy()
    }
  })

  test('secret env hints follow the env:VAR_NAME convention', () => {
    for (const id of AGENTIC_API_PROVIDER_IDS) {
      expect(DEFAULT_SECRET_ENV_HINTS[id]).toMatch(/^env:[A-Z0-9_]+$/)
    }
  })

  test('base URL hints are well-formed https URLs', () => {
    for (const id of AGENTIC_API_PROVIDER_IDS) {
      expect(() => new URL(DEFAULT_BASE_URLS[id])).not.toThrow()
    }
  })
})
