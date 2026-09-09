import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  dirnameFromImportMeta,
  fileURLToPath,
  homeDir,
  pathToFileURL,
  randomBytes,
  randomUUID,
  resolvePathUnder,
  safeReadDir,
  statSafe,
  writeTextFileAtomicSync,
} from '@/core/lib/fileHelper'
import { readYamlSafe } from '@/core/lib/yamlLib'

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

describe('fileHelper', () => {
  it('homeDir returns a string', () => {
    expect(typeof homeDir()).toBe('string')
  })

  it('writeTextFileAtomicSync writes content over an existing file and leaves no .tmp behind', async () => {
    const ownDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-fs-atomic-'))
    try {
      const file = path.join(ownDir, 'data.json')
      writeTextFileAtomicSync(file, '{"v":1}')
      writeTextFileAtomicSync(file, '{"v":2}')
      expect(await fs.readFile(file, 'utf8')).toBe('{"v":2}')
      expect((await safeReadDir(ownDir)).map((e) => e.name)).toEqual(['data.json'])
    } finally {
      await fs.rm(ownDir, { recursive: true, force: true })
    }
  })

  it('safeReadDir lists directory entries', async () => {
    const names = (await safeReadDir(dir)).map((e) => e.name).sort()
    expect(names).toEqual(['a.txt', 'bad.yaml', 'conf.yaml'])
  })

  it('safeReadDir returns [] for a missing directory', async () => {
    expect(await safeReadDir(path.join(dir, 'nope'))).toEqual([])
  })

  it('statSafe reports an existing file', async () => {
    const s = await statSafe(path.join(dir, 'a.txt'))
    expect(s.exists).toBe(true)
    expect(s.size).toBe(5)
    expect(typeof s.mtime).toBe('number')
  })

  it('statSafe reports a missing file defensively', async () => {
    expect(await statSafe(path.join(dir, 'missing'))).toEqual({
      exists: false,
      mtime: null,
      size: 0,
    })
  })

  it('resolvePathUnder keeps paths inside base', () => {
    const base = path.resolve(dir)
    expect(resolvePathUnder(base, 'a.txt')).toBe(path.resolve(base, 'a.txt'))
  })

  it('resolvePathUnder rejects traversal', () => {
    const base = path.resolve(dir)
    expect(resolvePathUnder(base, '..', 'outside')).toBeNull()
    expect(resolvePathUnder(base, '..')).toBeNull()
  })

  it('round-trips path ↔ file URL', () => {
    const p = path.join(dir, 'a.txt')
    expect(fileURLToPath(pathToFileURL(p))).toBe(p)
  })

  it('dirnameFromImportMeta matches parent of file URL', () => {
    const url = pathToFileURL(path.join(dir, 'a.txt')).href
    expect(dirnameFromImportMeta(url)).toBe(dir)
  })

  it('randomBytes returns the requested length', () => {
    expect(randomBytes(4)).toHaveLength(4)
  })

  it('randomUUID returns an RFC 4122-shaped string', () => {
    expect(randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})

describe('yamlLib readYamlSafe', () => {
  it('parses a YAML object', async () => {
    expect(await readYamlSafe(path.join(dir, 'conf.yaml'))).toEqual({
      driver: 'file',
      nested: { x: 1 },
    })
  })

  it('returns null for a missing file', async () => {
    expect(await readYamlSafe(path.join(dir, 'missing.yaml'))).toBeNull()
  })

  it('returns null for invalid YAML', async () => {
    expect(await readYamlSafe(path.join(dir, 'bad.yaml'))).toBeNull()
  })
})
