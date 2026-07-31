import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { homeDir, readYamlSafe, safeReadDir, statSafe } from '@shared/fs'

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-fs-test-'))
  await fs.writeFile(path.join(dir, 'a.txt'), 'hello')
  await fs.writeFile(path.join(dir, 'conf.yaml'), 'driver: file\nnested:\n  x: 1\n')
  await fs.writeFile(path.join(dir, 'bad.yaml'), ': : :')
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('homeDir', () => {
  it('returns a string', () => {
    expect(typeof homeDir()).toBe('string')
  })
})

describe('safeReadDir', () => {
  it('lists directory entries', async () => {
    const names = (await safeReadDir(dir)).map((e) => e.name).sort()
    expect(names).toEqual(['a.txt', 'bad.yaml', 'conf.yaml'])
  })
  it('returns [] for a missing directory', async () => {
    expect(await safeReadDir(path.join(dir, 'nope'))).toEqual([])
  })
})

describe('statSafe', () => {
  it('reports an existing file', async () => {
    const s = await statSafe(path.join(dir, 'a.txt'))
    expect(s.exists).toBe(true)
    expect(s.size).toBe(5)
    expect(typeof s.mtime).toBe('number')
  })
  it('reports a missing file defensively', async () => {
    expect(await statSafe(path.join(dir, 'missing'))).toEqual({ exists: false, mtime: null, size: 0 })
  })
})

describe('readYamlSafe', () => {
  it('parses a YAML object', async () => {
    expect(await readYamlSafe(path.join(dir, 'conf.yaml'))).toEqual({ driver: 'file', nested: { x: 1 } })
  })
  it('returns null for a missing file', async () => {
    expect(await readYamlSafe(path.join(dir, 'missing.yaml'))).toBeNull()
  })
  it('returns null for invalid YAML', async () => {
    expect(await readYamlSafe(path.join(dir, 'bad.yaml'))).toBeNull()
  })
})
