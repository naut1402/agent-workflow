import { describe, expect, test } from 'vitest'

// Harness smoke test — proves `vitest` (frontend unit runner) works.
// Remove once real co-located tests exist for shared/ and src/ modules.
describe('vitest harness', () => {
  test('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
