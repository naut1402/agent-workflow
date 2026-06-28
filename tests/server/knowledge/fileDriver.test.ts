import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFileDriver, knowledgeRoot, loadKnowledgeBundle } from '../../../server/knowledge/fileDriver'

let root: string
let driver: ReturnType<typeof createFileDriver>

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-'))
  driver = createFileDriver(root)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('write + read round-trip', () => {
  test('persists frontmatter + content and reads it back', async () => {
    const w = await driver.write({ title: 'My Note', slug: 'my-note', scope: 'project', tags: ['a', 'b'], content: 'hello' })
    expect(w.id).toBe('project/my-note')
    const r = await driver.read('project/my-note')
    expect(r.title).toBe('My Note')
    expect(r.scope).toBe('project')
    expect(r.tags).toEqual(['a', 'b'])
    expect(r.content.trim()).toBe('hello')
  })
  test('file lands under knowledge/<scope>/<slug>.md', async () => {
    await driver.write({ slug: 'x', scope: 'system', content: 'c' })
    const fp = path.join(knowledgeRoot(root), 'system', 'x.md')
    expect((await fs.readFile(fp, 'utf8')).startsWith('---')).toBe(true)
  })
  test('rejects an invalid scope', async () => {
    await expect(driver.write({ slug: 'y', scope: 'bogus' as any, content: 'c' })).rejects.toThrow('invalid scope')
  })
})

describe('list', () => {
  beforeEach(async () => {
    await driver.write({ slug: 'alpha', scope: 'project', tags: ['x'], content: 'find-me' })
    await driver.write({ slug: 'beta', scope: 'system', tags: ['y'], content: 'other' })
  })
  test('returns metadata without content', async () => {
    const all = await driver.list()
    expect(all).toHaveLength(2)
    expect((all[0] as any).content).toBeUndefined()
  })
  test('filters by scope, tags, query', async () => {
    expect(await driver.list({ scope: 'system' })).toHaveLength(1)
    expect(await driver.list({ tags: ['x'] })).toHaveLength(1)
    const q = await driver.list({ query: 'find-me' })
    expect(q).toHaveLength(1)
    expect(q[0].slug).toBe('alpha')
  })
})

describe('listTags / delete', () => {
  test('counts tags then removes an entry', async () => {
    await driver.write({ slug: 'a', tags: ['t1', 't2'], content: 'c' })
    await driver.write({ slug: 'b', tags: ['t1'], content: 'c' })
    const tags = await driver.listTags()
    expect(tags).toEqual([{ tag: 't1', count: 2 }, { tag: 't2', count: 1 }])
    expect(await driver.delete('project/a')).toEqual({ deleted: true, id: 'project/a' })
    expect(await driver.list()).toHaveLength(1)
  })
})

describe('upload', () => {
  test('parses frontmatter from an uploaded .md', async () => {
    const md = '---\ntitle: Up\ntags: [u1]\n---\nbody text'
    const entry = await driver.upload({ filename: 'up.md', content: md, scope: 'project' })
    expect(entry.title).toBe('Up')
    expect(entry.tags).toEqual(['u1'])
    expect(entry.content.trim()).toBe('body text')
  })
  test('rejects duplicate, oversized, and bad-extension uploads', async () => {
    await driver.upload({ filename: 'dup.txt', content: 'x', scope: 'project' })
    await expect(driver.upload({ filename: 'dup.txt', content: 'x', scope: 'project' })).rejects.toThrow('already exists')
    await expect(driver.upload({ filename: 'big.md', content: 'a'.repeat(512 * 1024 + 1), scope: 'project' })).rejects.toThrow('too large')
    await expect(driver.upload({ filename: 'bad.pdf', content: 'x', scope: 'project' })).rejects.toThrow('only .md and .txt')
  })
})

describe('loadKnowledgeBundle', () => {
  test('returns content for found ids and error for missing', async () => {
    await driver.write({ slug: 'k', scope: 'project', content: 'kc' })
    const bundle = await loadKnowledgeBundle(root, ['project/k', 'project/missing'])
    expect(bundle[0]).toMatchObject({ id: 'project/k' })
    expect(bundle[0].content.trim()).toBe('kc')
    expect(bundle[1]).toMatchObject({ id: 'project/missing', error: 'not found' })
  })
  test('empty ids → []', async () => {
    expect(await loadKnowledgeBundle(root, [])).toEqual([])
  })
})
