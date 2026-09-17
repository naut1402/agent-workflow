import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'

// Regression for T8ee57185: viewing/copying a `scope: project` custom agent
// (via `GET /api/catalog-agent`, id `dashboard:<name>`) 500'd with a raw
// ENOENT when the request resolved to a project other than the one the
// agent actually lives in — the FE call site was missing `?project=`
// (fixed separately in pipelineEditorApi.ts / call-sites), and the
// controller's `catch` blindly returned 500 for any read failure instead of
// distinguishing "file doesn't exist" (→ 404) from other I/O errors (→ 500),
// same as `readCustomAgent` already did. `GET /api/rule-content` has the
// same catch-block shape, so it's covered symmetrically here.

let projectRoot: string
let root: string // holds the agent (`dashboard:foo`) + registered rule doc
let projectRoot2: string
let root2: string // sibling project WITHOUT `foo` — resolves here when project is wrong/missing

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root2,
    resolveProjectRoot: (id: string | null) => {
      if (id === null) return root2
      if (id === 'proj1') return root
      if (id === 'proj2') return root2
      return null
    },
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

let app: Awaited<ReturnType<typeof createApp>>

beforeAll(async () => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-catalog-agent-p1-'))
  root = path.join(projectRoot, '.dev-team-agent')
  fs.mkdirSync(path.join(root, 'custom-agents'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'custom-agents', 'foo.md'),
    '---\ndescription: Foo agent\n---\n\n## Vai trò\n\nFoo role\n',
  )
  fs.mkdirSync(path.join(projectRoot, 'docs', 'agent-rules'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'docs', 'agent-rules', 'bar.md'), '# Bar rule\n')
  // Directory named `<name>.md` — resolves to a real path but `fs.readFile`
  // fails with EISDIR, not ENOENT: must stay 500 (D2 only narrows ENOENT).
  fs.mkdirSync(path.join(root, 'custom-agents', 'isdir.md'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, '.claude', 'rules'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, '.claude', 'rules', 'isdir.md'), { recursive: true })

  projectRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-catalog-agent-p2-'))
  root2 = path.join(projectRoot2, '.dev-team-agent')
  fs.mkdirSync(path.join(root2, 'custom-agents'), { recursive: true })

  app = await createApp(fakeCtx())
})

afterAll(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true })
  fs.rmSync(projectRoot2, { recursive: true, force: true })
})

describe('GET /api/catalog-agent — contract lỗi khi đọc file (D2)', () => {
  test('id tồn tại đúng ở project được ?project= chỉ định → 200', async () => {
    const res = await app.request('/api/catalog-agent?id=dashboard:foo&project=proj1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('dashboard:foo')
    expect(body.draft).toBeTruthy()
  })

  test('id hợp lệ nhưng không có ở project được resolve → 404 sạch, không lộ ENOENT/path', async () => {
    const res = await app.request('/api/catalog-agent?id=dashboard:foo&project=proj2')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(body.error).not.toContain('ENOENT')
    expect(body.error).not.toContain(root)
    expect(body.error).not.toContain(root2)
  })

  test('thiếu ?project= hoàn toàn, agent chỉ tồn tại ở project khác default → 404 sạch (đúng nguyên văn triệu chứng report)', async () => {
    const res = await app.request('/api/catalog-agent?id=dashboard:foo')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).not.toContain('ENOENT')
  })

  test('lỗi đọc không phải ENOENT (EISDIR) → vẫn 500, không mở rộng 404 quá tay', async () => {
    const res = await app.request('/api/catalog-agent?id=dashboard:isdir&project=proj1')
    expect(res.status).toBe(500)
  })
})

describe('GET /api/rule-content — contract lỗi khi đọc file (D2, đối xứng agent)', () => {
  test('id tồn tại đúng project → 200', async () => {
    const res = await app.request('/api/rule-content?id=project:docs/agent-rules/bar.md&project=proj1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toContain('Bar rule')
  })

  test('id hợp lệ, sai/thiếu project → 404 sạch, không ENOENT', async () => {
    const res = await app.request('/api/rule-content?id=project:docs/agent-rules/bar.md')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).not.toContain('ENOENT')
  })

  test('lỗi đọc khác ENOENT (EISDIR) → vẫn 500', async () => {
    const res = await app.request('/api/rule-content?id=project:.claude/rules/isdir.md&project=proj1')
    expect(res.status).toBe(500)
  })
})
