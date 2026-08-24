import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'

// Regression coverage for the "agent created via Agent Editor / NL-chat saved
// to the wrong project" incident (202608_005 investigate.md): `scope:
// 'project'` must land in *this* project's `custom-agents/` (resolved via
// `?project=`), `scope: 'global'` must land in `~/.claude/agents/` regardless
// of `?project=` — never silently fall back to the registry's default
// project the way the old unconditional `customAgentsDir(root)` write did.

let root: string
let home: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.HOME
const prevUserProfile = process.env.USERPROFILE

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agents-api-'))
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agents-home-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  app = await createApp(fakeCtx())
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = prevUserProfile
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(home, { recursive: true, force: true })
})

describe('POST /api/custom-agents — scope routing', () => {
  test('scope omitted (back-compat) defaults to project and writes under the resolved root', async () => {
    const res = await app.request('/api/custom-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: { name: 'legacy-agent' } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ saved: true, name: 'legacy-agent', scope: 'project' })
    expect(fs.existsSync(path.join(root, 'custom-agents', 'legacy-agent.md'))).toBe(true)
    expect(fs.existsSync(path.join(home, '.claude', 'agents', 'legacy-agent.md'))).toBe(false)
  })

  test('scope: "global" writes to ~/.claude/agents/ even without ?project=', async () => {
    const res = await app.request('/api/custom-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: { name: 'shared-agent' }, scope: 'global' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ saved: true, name: 'shared-agent', scope: 'global' })
    expect(fs.existsSync(path.join(home, '.claude', 'agents', 'shared-agent.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'custom-agents', 'shared-agent.md'))).toBe(false)
  })

  test('scope: "project" with an unresolvable ?project= still 404s (no silent default-project fallback)', async () => {
    const res = await app.request('/api/custom-agents?project=unknown-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: { name: 'orphan-agent' }, scope: 'project' }),
    })
    expect(res.status).toBe(404)
    expect(fs.existsSync(path.join(root, 'custom-agents', 'orphan-agent.md'))).toBe(false)
    expect(fs.existsSync(path.join(home, '.claude', 'agents', 'orphan-agent.md'))).toBe(false)
  })
})

describe('GET /api/custom-agents — merged project + global listing', () => {
  test('lists both scopes, each tagged', async () => {
    const res = await app.request('/api/custom-agents')
    expect(res.status).toBe(200)
    const body = await res.json()
    const legacy = body.agents.find((a: any) => a.name === 'legacy-agent')
    const shared = body.agents.find((a: any) => a.name === 'shared-agent')
    expect(legacy).toMatchObject({ scope: 'project' })
    expect(shared).toMatchObject({ scope: 'global' })
  })

  test('?name=&scope=global reads the global copy, not the project one', async () => {
    const res = await app.request('/api/custom-agents?name=shared-agent&scope=global')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ name: 'shared-agent', scope: 'global' })
  })

  test('?name= without scope (back-compat) still resolves the project copy', async () => {
    const res = await app.request('/api/custom-agents?name=legacy-agent')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ name: 'legacy-agent', scope: 'project' })
  })
})

describe('DELETE /api/custom-agents — scope routing', () => {
  test('scope: "global" deletes only the global copy', async () => {
    const res = await app.request('/api/custom-agents?name=shared-agent&scope=global', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(home, '.claude', 'agents', 'shared-agent.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'custom-agents', 'legacy-agent.md'))).toBe(true)
  })
})
