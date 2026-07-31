import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { handleKnowledgeApi } from '../../../../../src/features/knowledge/server/knowledgeApi'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-api-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function mockRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) { this.headers[k] = v },
    end(p: string) { this.body = p },
  }
}
// Minimal async-iterable request carrying an optional JSON body.
function mockReq(method: string, body?: string, headers: Record<string, string> = {}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body != null) yield body
    },
  } as any
}
const u = (qs = '') => new URL(`http://x/api/knowledge${qs}`)

describe('handleKnowledgeApi', () => {
  test('returns false for a non-knowledge path', async () => {
    const res = mockRes()
    const handled = await handleKnowledgeApi(mockReq('GET') as any, res as any, new URL('http://x/api/tasks'), root)
    expect(handled).toBe(false)
  })

  test('POST writes, GET lists + reads by id, DELETE removes', async () => {
    // POST create
    let res = mockRes()
    await handleKnowledgeApi(mockReq('POST', JSON.stringify({ slug: 'note1', scope: 'project', tags: ['t'], content: 'hi' })) as any, res as any, u(), root)
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).entry.id).toBe('project/note1')

    // GET list
    res = mockRes()
    await handleKnowledgeApi(mockReq('GET') as any, res as any, u(), root)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).entries).toHaveLength(1)

    // GET by id
    res = mockRes()
    await handleKnowledgeApi(mockReq('GET') as any, res as any, u('?id=project/note1'), root)
    expect(JSON.parse(res.body).entry.content.trim()).toBe('hi')

    // GET by unknown id → 404
    res = mockRes()
    await handleKnowledgeApi(mockReq('GET') as any, res as any, u('?id=project/nope'), root)
    expect(res.statusCode).toBe(404)

    // DELETE
    res = mockRes()
    await handleKnowledgeApi(mockReq('DELETE') as any, res as any, u('?id=project/note1'), root)
    expect(JSON.parse(res.body).deleted).toBe(true)
  })

  test('GET /tags returns tag counts', async () => {
    await handleKnowledgeApi(mockReq('POST', JSON.stringify({ slug: 'a', tags: ['x'], content: 'c' })) as any, mockRes() as any, u(), root)
    const res = mockRes()
    await handleKnowledgeApi(mockReq('GET') as any, res as any, u('/tags'), root)
    expect(JSON.parse(res.body).tags).toEqual([{ tag: 'x', count: 1 }])
  })

  test('POST with invalid JSON → 400', async () => {
    const res = mockRes()
    await handleKnowledgeApi(mockReq('POST', '{bad') as any, res as any, u(), root)
    expect(res.statusCode).toBe(400)
  })
})
