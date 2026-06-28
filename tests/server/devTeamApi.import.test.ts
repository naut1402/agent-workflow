import { describe, expect, test } from 'bun:test'

// Integration smoke: importing the API handler exercises the whole backend
// module graph, including devTeamApi.js (.js) importing the new shared/*.ts
// helpers. A resolution / load regression fails here immediately.
describe('devTeamApi module graph', () => {
  test('createApiHandler + devTeamApi load and are callable factories', async () => {
    const mod = await import('../../server/devTeamApi.js')
    expect(typeof mod.createApiHandler).toBe('function')
    expect(typeof mod.devTeamApi).toBe('function')
  })

  test('shared helpers are reachable from the server side', async () => {
    const { parseFrontmatter } = await import('../../shared/frontmatter')
    const { isPrivateHostname } = await import('../../shared/sanitize')
    expect(parseFrontmatter('---\nname: x\n---')).toEqual({ name: 'x' })
    expect(isPrivateHostname('127.0.0.1')).toBe(true)
  })
})
