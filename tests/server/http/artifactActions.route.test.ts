import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiHandler } from '../../../server/devTeamApi.js'
import { createRegistryContext } from '../../../server/registry.js'

// Route-level contract for the artifact quick-actions endpoints, booted the same
// way as the golden test (real node:http around createApiHandler + a throwaway
// `.dev-team-agent/` fixture). Kept separate from api.golden.test.ts so it can
// seed its own artifact-actions.yaml without disturbing the golden fixture.

let server: http.Server
let base: string
let root: string
let home: string
const savedEnv = { ...process.env }

function req(method: string, p: string, opts: { body?: string } = {}) {
  return fetch(`${base}${p}`, {
    method,
    body: opts.body,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  })
}

// The /run test submits a real job; on Windows its runner can still hold a handle
// under the temp dir when teardown runs, so a bare rmSync hits EBUSY/ENOTEMPTY.
// Retry with a short backoff before giving up.
async function rmDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EBUSY' && code !== 'ENOTEMPTY' && code !== 'EPERM') throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DEV_TEAM_API_TOKEN
  delete process.env.DEV_TEAM_ROOT

  fs.mkdirSync(path.join(root, 'tasks', 'T1'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', 'T1', 'design.md'), '# Design T1\n')
  fs.writeFileSync(
    path.join(root, 'artifact-actions.yaml'),
    [
      'version: 1',
      'actions:',
      '  - id: improve-doc',
      '    label: "✨ Cải thiện tài liệu"',
      '    artifact_patterns: ["investigate.md", "design.md", "review.md"]',
      '    agent_ref: dev-agent-teams:doc-reviewer',
      '    prompt_template: "Đọc {{artifact_name}} và cải thiện {{artifact_base}}."',
    ].join('\n'),
  )

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
  await rmDirWithRetry(home)
  await rmDirWithRetry(root)
})

describe('GET /api/artifact-actions', () => {
  test('returns matching actions for design.md as a UI-facing subset', async () => {
    const r = await req('GET', '/api/artifact-actions?artifact=design.md')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.artifact).toBe('design.md')
    expect(body.actions).toHaveLength(1)
    expect(body.actions[0]).toEqual({
      id: 'improve-doc',
      label: '✨ Cải thiện tài liệu',
      agent_ref: 'dev-agent-teams:doc-reviewer',
      confirm: false,
    })
    // Prompt template / patterns must not leak to the UI.
    expect(body.actions[0].prompt_template).toBeUndefined()
  })
  test('returns no actions for a non-matching artifact', async () => {
    const r = await req('GET', '/api/artifact-actions?artifact=qa.md')
    expect(r.status).toBe(200)
    expect((await r.json()).actions).toEqual([])
  })
})

describe('POST /api/artifact-actions/run', () => {
  test('queues a job for a valid action + artifact', async () => {
    const r = await req('POST', '/api/artifact-actions/run', {
      body: JSON.stringify({ taskId: 'T1', actionId: 'improve-doc', artifactName: 'design.md' }),
    })
    expect(r.status).toBe(201)
    const { job } = await r.json()
    expect(job.agentRef).toBe('dev-agent-teams:doc-reviewer')
    expect(job.userPrompt).toBe('Đọc design.md và cải thiện design.')
    expect(job.metadata.artifactAction).toBe('improve-doc')
    expect(['queued', 'running', 'failed']).toContain(job.status)
  })
  test('400 on invalid body', async () => {
    const r = await req('POST', '/api/artifact-actions/run', { body: JSON.stringify({ taskId: 'T1' }) })
    expect(r.status).toBe(400)
  })
  test('404 for unknown action', async () => {
    const r = await req('POST', '/api/artifact-actions/run', {
      body: JSON.stringify({ taskId: 'T1', actionId: 'nope', artifactName: 'design.md' }),
    })
    expect(r.status).toBe(404)
  })
  test('400 when the action does not apply to the artifact', async () => {
    fs.writeFileSync(path.join(root, 'tasks', 'T1', 'qa.md'), '# QA\n')
    const r = await req('POST', '/api/artifact-actions/run', {
      body: JSON.stringify({ taskId: 'T1', actionId: 'improve-doc', artifactName: 'qa.md' }),
    })
    expect(r.status).toBe(400)
  })
  test('404 when the artifact file is missing', async () => {
    const r = await req('POST', '/api/artifact-actions/run', {
      body: JSON.stringify({ taskId: 'T1', actionId: 'improve-doc', artifactName: 'investigate.md' }),
    })
    expect(r.status).toBe(404)
  })
  test('400 on path traversal in artifactName', async () => {
    const r = await req('POST', '/api/artifact-actions/run', {
      body: JSON.stringify({ taskId: 'T1', actionId: 'improve-doc', artifactName: '../../secret' }),
    })
    expect(r.status).toBe(400)
  })
})
