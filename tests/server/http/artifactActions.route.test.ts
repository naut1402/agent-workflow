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
  // Catalog is dashboard-global (same home as runners), not under project root.
  fs.writeFileSync(
    path.join(home, 'artifact-actions.yaml'),
    [
      'version: 1',
      'menus:',
      '  - id: docs',
      '    label: "Tài liệu"',
      '    children:',
      '      - id: leaf-improve-doc',
      '        label: "✨ Cải thiện tài liệu"',
      '        action_id: improve-doc',
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
      attach_points: ['artifact-title'],
      require_approval: false,
    })
    // Prompt template / patterns must not leak to the UI.
    expect(body.actions[0].prompt_template).toBeUndefined()
    expect(body.menus).toEqual([
      {
        id: 'docs',
        label: 'Tài liệu',
        children: [{ id: 'leaf-improve-doc', label: '✨ Cải thiện tài liệu', action_id: 'improve-doc' }],
      },
    ])
  })
  test('returns no actions for a non-matching artifact', async () => {
    const r = await req('GET', '/api/artifact-actions?artifact=qa.md')
    expect(r.status).toBe(200)
    expect((await r.json()).actions).toEqual([])
  })
  test('?attach=artifact-selection filters out a title-only action', async () => {
    const r = await req('GET', '/api/artifact-actions?artifact=design.md&attach=artifact-selection')
    expect(r.status).toBe(200)
    expect((await r.json()).actions).toEqual([])
  })
  test('?attach=artifact-title keeps the (default title-only) action', async () => {
    const r = await req('GET', '/api/artifact-actions?artifact=design.md&attach=artifact-title')
    expect(r.status).toBe(200)
    expect((await r.json()).actions).toHaveLength(1)
  })
  test('omitting ?artifact= returns the full catalog (CRUD shape)', async () => {
    const r = await req('GET', '/api/artifact-actions')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.version).toBe(1)
    expect(body.actions).toHaveLength(1)
    // Full fields (prompt_template / patterns) are present for the CRUD form.
    expect(body.actions[0].prompt_template).toContain('{{artifact_name}}')
    expect(body.actions[0].artifact_patterns).toContain('design.md')
    expect(body.menus).toEqual([
      {
        id: 'docs',
        label: 'Tài liệu',
        children: [{ id: 'leaf-improve-doc', label: '✨ Cải thiện tài liệu', action_id: 'improve-doc' }],
      },
    ])
  })
})

describe('PUT /api/artifact-actions', () => {
  test('saves a full catalog replace and round-trips via GET', async () => {
    const putRes = await req('PUT', '/api/artifact-actions', {
      body: JSON.stringify({
        version: 2,
        menus: [
          {
            id: 'docs',
            label: 'Tài liệu',
            children: [{ id: 'leaf-note', label: 'Ghi chú', action_id: 'note' }],
          },
        ],
        actions: [
          {
            id: 'note',
            label: 'Ghi chú',
            artifact_patterns: ['*.md'],
            agent_ref: 'dev-agent-teams:doc-reviewer',
            prompt_template: 'Ghi chú cho {{artifact_name}}: {{selection}}',
            attach_points: ['artifact-title', 'artifact-selection'],
          },
        ],
      }),
    })
    expect(putRes.status).toBe(200)
    const putBody = await putRes.json()
    expect(putBody.ok).toBe(true)
    expect(putBody.actions[0].id).toBe('note')
    expect(putBody.menus).toEqual([
      {
        id: 'docs',
        label: 'Tài liệu',
        children: [{ id: 'leaf-note', label: 'Ghi chú', action_id: 'note' }],
      },
    ])

    const getRes = await req('GET', '/api/artifact-actions')
    const getBody = await getRes.json()
    expect(getBody.version).toBe(2)
    expect(getBody.actions.map((a: { id: string }) => a.id)).toEqual(['note'])
    expect(getBody.menus).toEqual([
      {
        id: 'docs',
        label: 'Tài liệu',
        children: [{ id: 'leaf-note', label: 'Ghi chú', action_id: 'note' }],
      },
    ])

    // Restore the fixture catalog used by the other describe blocks below.
    await req('PUT', '/api/artifact-actions', {
      body: JSON.stringify({
        version: 1,
        menus: [
          {
            id: 'docs',
            label: 'Tài liệu',
            children: [{ id: 'leaf-improve-doc', label: '✨ Cải thiện tài liệu', action_id: 'improve-doc' }],
          },
        ],
        actions: [
          {
            id: 'improve-doc',
            label: '✨ Cải thiện tài liệu',
            artifact_patterns: ['investigate.md', 'design.md', 'review.md'],
            agent_ref: 'dev-agent-teams:doc-reviewer',
            prompt_template: 'Đọc {{artifact_name}} và cải thiện {{artifact_base}}.',
          },
        ],
      }),
    })
  })
  test('400 on duplicate ids, catalog left untouched', async () => {
    const before = await (await req('GET', '/api/artifact-actions')).json()
    const r = await req('PUT', '/api/artifact-actions', {
      body: JSON.stringify({
        version: 1,
        actions: [
          {
            id: 'dup',
            label: 'A',
            artifact_patterns: ['a.md'],
            agent_ref: 'x',
            prompt_template: 'p',
          },
          {
            id: 'dup',
            label: 'B',
            artifact_patterns: ['b.md'],
            agent_ref: 'x',
            prompt_template: 'p',
          },
        ],
      }),
    })
    expect(r.status).toBe(400)
    const after = await (await req('GET', '/api/artifact-actions')).json()
    expect(after).toEqual(before)
  })
  test('400 on schema-invalid body', async () => {
    const r = await req('PUT', '/api/artifact-actions', {
      body: JSON.stringify({ version: 1, actions: [{ id: 'bad' }] }),
    })
    expect(r.status).toBe(400)
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

  test('substitutes {{selection}} and records selection metadata on the job', async () => {
    const r = await req('POST', '/api/artifact-actions/run', {
      body: JSON.stringify({
        taskId: 'T1',
        actionId: 'improve-doc',
        artifactName: 'design.md',
        selectedText: 'đoạn văn bôi đen',
      }),
    })
    expect(r.status).toBe(201)
    const { job } = await r.json()
    expect(job.metadata.hasSelection).toBe(true)
    expect(job.metadata.selectionChars).toBe('đoạn văn bôi đen'.length)
    expect(job.metadata.selectionStartLine).toBeUndefined()
    expect(job.metadata.selectionEndLine).toBeUndefined()
  })

  test('records selectionStartLine/selectionEndLine on the job when supplied', async () => {
    const r = await req('POST', '/api/artifact-actions/run', {
      body: JSON.stringify({
        taskId: 'T1',
        actionId: 'improve-doc',
        artifactName: 'design.md',
        selectedText: 'đoạn văn bôi đen',
        selectionStartLine: 12,
        selectionEndLine: 15,
      }),
    })
    expect(r.status).toBe(201)
    const { job } = await r.json()
    expect(job.metadata.selectionStartLine).toBe(12)
    expect(job.metadata.selectionEndLine).toBe(15)
  })

  describe('selection-only action', () => {
    beforeAll(async () => {
      await req('PUT', '/api/artifact-actions', {
        body: JSON.stringify({
          version: 1,
          actions: [
            {
              id: 'improve-doc',
              label: '✨ Cải thiện tài liệu',
              artifact_patterns: ['investigate.md', 'design.md', 'review.md'],
              agent_ref: 'dev-agent-teams:doc-reviewer',
              prompt_template: 'Đọc {{artifact_name}} và cải thiện {{artifact_base}}.',
            },
            {
              id: 'explain-selection',
              label: 'Giải thích đoạn chọn',
              artifact_patterns: ['design.md'],
              agent_ref: 'dev-agent-teams:doc-reviewer',
              prompt_template: 'Giải thích: {{selection}}',
              attach_points: ['artifact-selection'],
              runner_id: 'runner-from-action',
            },
          ],
        }),
      })
    })
    afterAll(async () => {
      // Restore the plain fixture catalog for any later test file ordering.
      await req('PUT', '/api/artifact-actions', {
        body: JSON.stringify({
          version: 1,
          actions: [
            {
              id: 'improve-doc',
              label: '✨ Cải thiện tài liệu',
              artifact_patterns: ['investigate.md', 'design.md', 'review.md'],
              agent_ref: 'dev-agent-teams:doc-reviewer',
              prompt_template: 'Đọc {{artifact_name}} và cải thiện {{artifact_base}}.',
            },
          ],
        }),
      })
    })

    test('400 "selection required" when selectedText is missing', async () => {
      const r = await req('POST', '/api/artifact-actions/run', {
        body: JSON.stringify({ taskId: 'T1', actionId: 'explain-selection', artifactName: 'design.md' }),
      })
      expect(r.status).toBe(400)
      expect((await r.json()).error).toBe('selection required')
    })

    test('runs with selectedText and falls back to the action runner_id', async () => {
      const r = await req('POST', '/api/artifact-actions/run', {
        body: JSON.stringify({
          taskId: 'T1',
          actionId: 'explain-selection',
          artifactName: 'design.md',
          selectedText: 'đoạn bôi đen',
        }),
      })
      expect(r.status).toBe(201)
      const { job } = await r.json()
      expect(job.userPrompt).toBe('Giải thích: đoạn bôi đen')
      // Neither fixture runner id exists in the registry, so `getRunner` returns
      // null — `submitJob` then falls back to the *requested* id verbatim,
      // which is enough to prove `action.runner_id` was threaded through.
      expect(job.runnerId).toBe('runner-from-action')
    })

    test('request runnerId still wins over the action default', async () => {
      const r = await req('POST', '/api/artifact-actions/run', {
        body: JSON.stringify({
          taskId: 'T1',
          actionId: 'explain-selection',
          artifactName: 'design.md',
          selectedText: 'x',
          runnerId: 'runner-from-request',
        }),
      })
      expect(r.status).toBe(201)
      const { job } = await r.json()
      expect(job.runnerId).toBe('runner-from-request')
    })
  })
})
