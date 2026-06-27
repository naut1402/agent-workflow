import { describe, expect, test } from 'bun:test'

// Harness smoke test — proves `bun test` (backend unit/integration runner) works.
// Remove once real co-located tests exist for the server modules.
describe('bun test harness', () => {
  test('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
