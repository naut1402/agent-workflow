import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiHandler } from '../../../server/devTeamApi.js'
import { createRegistryContext } from '../../../server/registry.js'

// ── Golden / characterization test for the whole /api surface ──────────────────
//
// Boots a real node:http server around createApiHandler against a throwaway
// `.dev-team-agent/` fixture and asserts the request→response contract
// (status codes, JSON shapes, traversal guards, body handling).
//
// It imports the PUBLIC handler (createApiHandler), so it survives the swap of
// the internal implementation from the hand-rolled dispatcher to Hono — the
// same assertions must stay green after the migration. This is the safety net
// the http module is refactored under.

let server: http.Server
let base: string
let root: string
let home: string
let localProj: string
const savedEnv = { ...process.env }

function req(method: string, p: string, opts: { body?: string; headers?: Record<string, string> } = {}) {
  return fetch(`${base}${p}`, { method, body: opts.body, headers: opts.headers })
}

beforeAll(async () => {
  // Isolate the registry store and the default-root resolution from the host.
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DEV_TEAM_ROOT

  // Minimal fixture: one task with live state + one artifact.
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', 'T1'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', 'T1.json'),
    JSON.stringify({ current_phase: 'design', hitl_pending: false, review_round: 0 }),
  )
  fs.writeFileSync(path.join(root, 'tasks', 'T1', 'investigate.md'), '# Investigate T1\n')

  localProj = fs.mkdtempSync(path.join(home, 'local-proj-'))
  fs.mkdirSync(path.join(localProj, '.dev-team-agent'), { recursive: true })

  const ctx = createRegistryContext({ defaultRoot: root })
  const handler = createApiHandler(ctx)
  server = http.createServer(async (r, res) => {
    const handled = await handler(r, res)
    if (!handled) {
      res.statusCode = 418
      res.end('non-api')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})

describe('non-API fall-through', () => {
  test('handler returns false for non /api/ paths', async () => {
    const handler = createApiHandler(createRegistryContext({ defaultRoot: root }))
    const handled = await handler({ url: '/index.html', method: 'GET' } as any, {} as any)
    expect(handled).toBe(false)
  })
  test('server falls through (418 sentinel) for non-api request', async () => {
    const r = await req('GET', '/not-api')
    expect(r.status).toBe(418)
  })
})

describe('GET /api/tasks', () => {
  test('returns root + tasks with artifacts', async () => {
    const r = await req('GET', '/api/tasks')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.root).toBe(root)
    expect(Array.isArray(body.tasks)).toBe(true)
    expect(body.tasks.length).toBe(1)
    expect(body.tasks[0].task_id).toBe('T1')
  })
  test('echoes project id when explicitly requested but unknown → 404', async () => {
    const r = await req('GET', '/api/tasks?project=nope')
    expect(r.status).toBe(404)
    expect((await r.json()).error).toBe('unknown project')
  })
})

describe('GET /api/pipeline-config', () => {
  test('returns a resolved pipeline with steps', async () => {
    const r = await req('GET', '/api/pipeline-config')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body.pipeline.steps)).toBe(true)
    expect(body.pipeline.steps.length).toBeGreaterThan(0)
  })
})

describe('GET /api/artifact', () => {
  test('reads an artifact', async () => {
    const r = await req('GET', '/api/artifact?id=T1&name=investigate.md')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.content).toContain('Investigate T1')
  })
  test('rejects path traversal', async () => {
    const r = await req('GET', '/api/artifact?id=T1&name=' + encodeURIComponent('../../secret'))
    expect(r.status).toBe(400)
  })
  test('404 for missing artifact', async () => {
    const r = await req('GET', '/api/artifact?id=T1&name=nope.md')
    expect(r.status).toBe(404)
  })
})

describe('PUT /api/artifact', () => {
  test('updates an artifact', async () => {
    const getBefore = await req('GET', '/api/artifact?id=T1&name=investigate.md')
    const before = await getBefore.json()
    const next = '# Investigate T1\n\nUpdated via PUT\n'
    const put = await req('PUT', '/api/artifact?id=T1&name=investigate.md', {
      body: JSON.stringify({ content: next, mtime: before.mtime }),
    })
    expect(put.status).toBe(200)
    const saved = await put.json()
    expect(saved.content).toBe(next)
    expect(saved.mtime).toBeGreaterThanOrEqual(before.mtime)

    const getAfter = await req('GET', '/api/artifact?id=T1&name=investigate.md')
    expect((await getAfter.json()).content).toBe(next)
  })

  test('rejects invalid task id', async () => {
    const r = await req('PUT', '/api/artifact?id=bad/id&name=investigate.md', {
      body: JSON.stringify({ content: 'x' }),
    })
    expect(r.status).toBe(400)
  })

  test('rejects non-md artifact name', async () => {
    const r = await req('PUT', '/api/artifact?id=T1&name=secret.txt', {
      body: JSON.stringify({ content: 'x' }),
    })
    expect(r.status).toBe(400)
  })

  test('409 on mtime conflict', async () => {
    const get = await req('GET', '/api/artifact?id=T1&name=investigate.md')
    const body = await get.json()
    const put = await req('PUT', '/api/artifact?id=T1&name=investigate.md', {
      body: JSON.stringify({ content: body.content + '\n', mtime: body.mtime - 1 }),
    })
    expect(put.status).toBe(409)
    const conflict = await put.json()
    expect(conflict.error).toBe('conflict')
    expect(conflict.content).toContain('Investigate T1')
  })
})

describe('GET /api/profile + POST', () => {
  test('GET → exists:false when no profile', async () => {
    const r = await req('GET', '/api/profile')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ profile: null, exists: false })
  })
  test('POST → 501 not implemented', async () => {
    const r = await req('POST', '/api/profile', { body: '{}' })
    expect(r.status).toBe(501)
  })
})

describe('/api/flow-profile roundtrip', () => {
  test('POST then GET returns the saved profile', async () => {
    const save = await req('POST', '/api/flow-profile?id=T1', { body: JSON.stringify({ nodes: [1, 2] }) })
    expect(save.status).toBe(200)
    expect((await save.json()).saved).toBe(true)
    const get = await req('GET', '/api/flow-profile?id=T1')
    expect(get.status).toBe(200)
    const body = await get.json()
    expect(body.exists).toBe(true)
    expect(body.profile).toEqual({ nodes: [1, 2] })
  })
  test('GET without id → 400', async () => {
    const r = await req('GET', '/api/flow-profile')
    expect(r.status).toBe(400)
  })
})

describe('POST /api/pipeline-config-write', () => {
  test('global scope writes pipeline.yaml', async () => {
    const r = await req('POST', '/api/pipeline-config-write', {
      body: JSON.stringify({ scope: 'global', pipeline: { steps: [{ id: 'x' }] } }),
    })
    expect(r.status).toBe(200)
    expect((await r.json()).written).toBe(true)
    expect(fs.existsSync(path.join(root, 'pipeline.yaml'))).toBe(true)
  })
  test('invalid body → 400', async () => {
    const r = await req('POST', '/api/pipeline-config-write', { body: JSON.stringify({ scope: 'global' }) })
    expect(r.status).toBe(400)
  })
})

describe('/api/custom-agents', () => {
  test('GET empty list', async () => {
    const r = await req('GET', '/api/custom-agents')
    expect(r.status).toBe(200)
    expect((await r.json()).agents).toEqual([])
  })
  test('POST invalid name → 400', async () => {
    const r = await req('POST', '/api/custom-agents', { body: JSON.stringify({ name: '..' }) })
    expect(r.status).toBe(400)
  })
  test('POST invalid JSON → 400', async () => {
    const r = await req('POST', '/api/custom-agents', { body: '{not json' })
    expect(r.status).toBe(400)
  })
})

describe('project registry routes', () => {
  test('GET /api/projects → empty registry', async () => {
    const r = await req('GET', '/api/projects')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.projects).toEqual([])
    expect(body.defaultId).toBe(null)
  })
  test('PUT /api/projects → 405', async () => {
    const r = await req('PUT', '/api/projects')
    expect(r.status).toBe(405)
  })
})

describe('GET /api/rules', () => {
  test('200 object', async () => {
    const r = await req('GET', '/api/rules')
    expect(r.status).toBe(200)
    expect(typeof (await r.json())).toBe('object')
  })
})

describe('GET /api/knowledge/tags', () => {
  test('200 with tags array', async () => {
    const r = await req('GET', '/api/knowledge/tags')
    expect(r.status).toBe(200)
    expect(Array.isArray((await r.json()).tags)).toBe(true)
  })
})

describe('POST /api/pipeline-config-write project scope', () => {
  test('scoped project preserves defaults and doc_reviewer', async () => {
    const added = await req('POST', '/api/projects', { body: JSON.stringify({ path: localProj }) })
    const { project } = await added.json()
    const pipeline = {
      version: 1,
      defaults: { auto_review: true, export_json: false },
      steps: [{ id: 's1', name: 'S1', export_key: 's1' }],
      doc_reviewer: { agent: 'a', rule_required: false },
    }
    const write = await req('POST', `/api/pipeline-config-write?project=${project.id}`, {
      body: JSON.stringify({ scope: 'global', pipeline }),
    })
    expect(write.status).toBe(200)
    const get = await req('GET', `/api/pipeline-config?project=${project.id}`)
    expect(get.status).toBe(200)
    const body = await get.json()
    expect(body.pipeline.defaults).toMatchObject(pipeline.defaults)
    expect(body.pipeline.doc_reviewer).toEqual(pipeline.doc_reviewer)
    expect(body.pipeline.steps[0].export_key).toBe('s1')
  })
})

describe('POST /api/pipeline-profiles project scope', () => {
  test('POST pipeline-profile scopes to ?project=', async () => {
    const projDir = fs.mkdtempSync(path.join(home, 'scoped-proj-'))
    fs.mkdirSync(path.join(projDir, '.dev-team-agent'), { recursive: true })
    const added = await req('POST', '/api/projects', { body: JSON.stringify({ path: projDir }) })
    const { project } = await added.json()
    const pipeline = {
      version: 1,
      defaults: { auto_review: true },
      steps: [{ id: 's1', name: 'S1' }],
      doc_reviewer: { agent: 'a', rule_required: false },
    }
    const save = await req('POST', `/api/pipeline-profiles?project=${project.id}`, {
      body: JSON.stringify({ name: 'scoped', pipeline }),
    })
    expect(save.status).toBe(200)
    const profilePath = path.join(projDir, '.dev-team-agent', 'pipeline-profiles', 'scoped.yaml')
    expect(fs.existsSync(profilePath)).toBe(true)
    const defaultProfilePath = path.join(root, 'pipeline-profiles', 'scoped.yaml')
    expect(fs.existsSync(defaultProfilePath)).toBe(false)
  })
})

describe('unknown endpoint', () => {
  test('404 unknown endpoint', async () => {
    const r = await req('GET', '/api/does-not-exist')
    expect(r.status).toBe(404)
    expect((await r.json()).error).toBe('unknown endpoint')
  })
})
