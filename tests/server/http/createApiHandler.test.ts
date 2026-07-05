import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiHandler } from '../../../server/http/createApiHandler.js'
import { readLogs } from '../../../server/logging/store.js'
import type { RegistryContext } from '../../../server/registry.js'

// Drives the node⇆Hono bridge directly to assert the request-logging hook
// (which lives in createApiHandler, NOT the Hono middleware, so app.request
// can't exercise it) and the non-api `return false` fall-through contract.

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: home,
    resolveProjectRoot: () => home,
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      addFromGit: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      syncGitProject: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      pushGitWorkspace: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      addSshProject: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      addApiProject: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      syncArtifactsProject: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      validateSshProject: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v
    },
    end(buf?: unknown) {
      this.body = buf == null ? '' : typeof buf === 'string' ? buf : String(buf)
    },
  }
}

const handle = createApiHandler(fakeCtx())

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-apihandler-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
})

describe('createApiHandler request logging', () => {
  test('non-api path returns false and logs nothing', async () => {
    const res = mockRes()
    const handled = await handle({ url: '/health', method: 'GET', headers: {} } as any, res as any)
    expect(handled).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(await readLogs({ type: 'request' })).toEqual([])
  })

  test('api request is handled and appends one request-log line', async () => {
    const res = mockRes()
    const handled = await handle(
      { url: '/api/projects', method: 'GET', headers: {} } as any,
      res as any,
    )
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    await new Promise((r) => setTimeout(r, 20))
    const entries = await readLogs({ type: 'request' })
    expect(entries.length).toBe(1)
    expect(entries[0]).toMatchObject({ type: 'request', method: 'GET', path: '/api/projects', status: 200 })
  })
})
