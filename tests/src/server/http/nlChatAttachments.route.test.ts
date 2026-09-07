import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'

// Route-level contract for POST /api/nl-chat/attachments — the only multipart
// endpoint of the chat surface. It is parsed with `c.req.formData()` rather
// than the older hand-rolled multipart helpers, which stringify the body and
// corrupt binaries; the binary-integrity case below is what pins that down.
// Driven via Hono's app.request, same style as taskFeedback.route.test.ts.

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

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

function upload(parts: { files?: File[]; taskId?: string } = {}) {
  const fd = new FormData()
  for (const f of parts.files ?? []) fd.append('files', f)
  if (parts.taskId !== undefined) fd.append('taskId', parts.taskId)
  return app.request('/api/nl-chat/attachments', { method: 'POST', body: fd })
}

function png(name = 'shot.png', bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])): File {
  return new File([bytes], name, { type: 'image/png' })
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-nlchat-attach-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  fs.mkdirSync(path.join(root, 'tasks', 'T1'), { recursive: true })
  app = await createApp(fakeCtx())
})

afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})

describe('POST /api/nl-chat/attachments', () => {
  test('a valid upload returns 201 with a readable absolute path', async () => {
    const res = await upload({ files: [png()] })
    expect(res.status).toBe(201)

    const body: any = await res.json()
    expect(body.files).toHaveLength(1)
    expect(body.files[0]).toMatchObject({ name: 'shot.png', type: 'image/png' })
    expect(path.isAbsolute(body.files[0].path)).toBe(true)
    expect(fs.existsSync(body.files[0].path)).toBe(true)
  })

  test('binary bytes round-trip unchanged through multipart', async () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i
    const res = await upload({ files: [png('bin.png', bytes)] })
    const body: any = await res.json()
    expect(new Uint8Array(fs.readFileSync(body.files[0].path))).toEqual(bytes)
  })

  test('a taskId puts the file inside that task directory', async () => {
    const res = await upload({ files: [png()], taskId: 'T1' })
    const body: any = await res.json()
    expect(body.files[0].path.startsWith(path.join(root, 'tasks', 'T1', 'attachments'))).toBe(true)
  })

  test('no taskId puts the file in the shared chat upload area', async () => {
    const res = await upload({ files: [png()] })
    const body: any = await res.json()
    expect(body.files[0].path.startsWith(path.join(root, 'uploads', 'chat'))).toBe(true)
  })

  test('several files come back in order, each written to disk', async () => {
    const res = await upload({ files: [png('a.png'), png('b.png'), png('c.png')] })
    const body: any = await res.json()
    expect(body.files.map((f: any) => f.name)).toEqual(['a.png', 'b.png', 'c.png'])
    for (const f of body.files) expect(fs.existsSync(f.path)).toBe(true)
  })

  test('two files sharing a name are both kept', async () => {
    const res = await upload({ files: [png('same.png'), png('same.png')] })
    const body: any = await res.json()
    expect(body.files.map((f: any) => f.name)).toEqual(['same.png', 'same-2.png'])
  })

  test('a traversal filename stays under the data root', async () => {
    const res = await upload({ files: [png('../../../evil.png')] })
    const body: any = await res.json()
    expect(res.status).toBe(201)
    expect(body.files[0].name).toBe('evil.png')
    expect(body.files[0].path.startsWith(root + path.sep)).toBe(true)
  })

  test('an unknown taskId is a 400, not a silent fallback', async () => {
    const res = await upload({ files: [png()], taskId: 'no-such-task' })
    expect(res.status).toBe(400)
  })

  test('a traversal taskId is a 400', async () => {
    const res = await upload({ files: [png()], taskId: '../..' })
    expect(res.status).toBe(400)
  })

  test('a MIME outside the allowlist is a 415', async () => {
    const bad = new File([new Uint8Array([1, 2])], 'run.exe', { type: 'application/x-msdownload' })
    const res = await upload({ files: [bad] })
    expect(res.status).toBe(415)
  })

  test('more than five files is a 400', async () => {
    const files = Array.from({ length: 6 }, (_, i) => png(`f${i}.png`))
    const res = await upload({ files })
    expect(res.status).toBe(400)
  })

  test('a request with no file part is a 400', async () => {
    const res = await upload({})
    expect(res.status).toBe(400)
  })

  test('a non-multipart body is rejected, not crashed on', async () => {
    const res = await app.request('/api/nl-chat/attachments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"files":[]}',
    })
    expect(res.status).toBe(400)
    expect(res.status).toBeLessThan(500)
  })
})
