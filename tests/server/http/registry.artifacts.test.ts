import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../server/http/app.js'
import { createRegistryContext } from '../../../server/registry.js'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-artifacts-http-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DEV_TEAM_API_TOKEN
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  delete process.env.DEV_TEAM_API_TOKEN
})

async function request(method: string, url: string, body?: unknown) {
  const app = createApp(createRegistryContext())
  return app.request(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/projects (kind api) + POST /:id/artifacts', () => {
  test('round-trip: register api project, sync files, apiSync.lastSyncedAt is set', async () => {
    const created = await request('POST', '/api/projects', { kind: 'api', name: 'API Project' })
    expect(created.status).toBe(201)
    const { project } = await created.json()
    expect(project.kind).toBe('api')

    const synced = await request('POST', `/api/projects/${project.id}/artifacts`, {
      files: [{ relPath: 'tasks/U0001/design.md', content: '# Design' }],
    })
    expect(synced.status).toBe(200)
    const syncBody = await synced.json()
    expect(syncBody.filesWritten).toBe(1)
    expect(syncBody.project.apiSync?.lastSyncedAt).toBeTruthy()

    const fetched = await request('GET', `/api/projects?id=${project.id}`)
    const fetchedBody = await fetched.json()
    expect(fetchedBody.project.apiSync?.lastSyncedAt).toBeTruthy()
  })

  test('invalid body — missing files → 400', async () => {
    const created = await request('POST', '/api/projects', { kind: 'api', name: 'API Project 2' })
    const { project } = await created.json()
    const res = await request('POST', `/api/projects/${project.id}/artifacts`, {})
    expect(res.status).toBe(400)
  })

  test('invalid body — empty relPath → 400', async () => {
    const created = await request('POST', '/api/projects', { kind: 'api', name: 'API Project 3' })
    const { project } = await created.json()
    const res = await request('POST', `/api/projects/${project.id}/artifacts`, {
      files: [{ relPath: '', content: 'x' }],
    })
    expect(res.status).toBe(400)
  })

  test('unknown project id → 404', async () => {
    const res = await request('POST', '/api/projects/nope/artifacts', { files: [] })
    expect(res.status).toBe(404)
  })

  test('syncing a non-api-kind project → 400', async () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-artifacts-proj-'))
    fs.mkdirSync(path.join(proj, '.dev-team-agent'), { recursive: true })
    const created = await request('POST', '/api/projects', { path: proj })
    const { project } = await created.json()
    const res = await request('POST', `/api/projects/${project.id}/artifacts`, { files: [] })
    expect(res.status).toBe(400)
    fs.rmSync(proj, { recursive: true, force: true })
  })

  test('when DEV_TEAM_API_TOKEN set, request without token → 401', async () => {
    process.env.DEV_TEAM_API_TOKEN = 'secret'
    const res = await request('POST', '/api/projects/anything/artifacts', { files: [] })
    expect(res.status).toBe(401)
  })
})
