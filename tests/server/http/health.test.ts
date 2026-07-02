import { beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../server/http/app.js'
import type { RegistryContext } from '../../../server/registry.js'

let root: string
let app: ReturnType<typeof createApp>

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: () => root,
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      addFromGit: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      syncGitProject: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      pushGitWorkspace: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-health-'))
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  app = createApp(fakeCtx())
})

describe('GET /api/health', () => {
  test('returns 200 with { ok:true, version } (no project required)', async () => {
    delete process.env.DEV_TEAM_API_TOKEN
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
  })
})

