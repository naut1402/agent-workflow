import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectArtifactFiles,
  resolveSafeArtifactPath,
  writeArtifacts,
} from '../../../server/workspace/artifactSync.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-sync-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveSafeArtifactPath', () => {
  test('rejects path traversal, absolute path, null byte', () => {
    expect(resolveSafeArtifactPath(root, '../etc/passwd')).toBeNull()
    expect(resolveSafeArtifactPath(root, '/etc/passwd')).toBeNull()
    expect(resolveSafeArtifactPath(root, 'tasks/../../etc/passwd')).toBeNull()
    expect(resolveSafeArtifactPath(root, 'tasks/foo\0bar')).toBeNull()
  })

  test('rejects path outside whitelist', () => {
    expect(resolveSafeArtifactPath(root, 'orchestrator-remote.json')).toBeNull()
    expect(resolveSafeArtifactPath(root, 'random.txt')).toBeNull()
    expect(resolveSafeArtifactPath(root, '.dev-team-agent/tasks/U0001/design.md')).toBeNull()
  })

  test('accepts allowed exact files and prefixes', () => {
    expect(resolveSafeArtifactPath(root, 'tasks/U0001/design.md')).toBe(
      path.resolve(root, 'tasks/U0001/design.md'),
    )
    expect(resolveSafeArtifactPath(root, '.dev-state/U0001.json')).toBe(
      path.resolve(root, '.dev-state/U0001.json'),
    )
    expect(resolveSafeArtifactPath(root, 'pipeline.yaml')).toBe(path.resolve(root, 'pipeline.yaml'))
    expect(resolveSafeArtifactPath(root, 'knowledge/foo.md')).toBe(path.resolve(root, 'knowledge/foo.md'))
    expect(resolveSafeArtifactPath(root, 'project-rules.md')).toBe(path.resolve(root, 'project-rules.md'))
  })
})

describe('writeArtifacts', () => {
  test('writes new files and returns filesWritten', async () => {
    const result = await writeArtifacts({
      projectRoot: root,
      files: [
        { relPath: 'tasks/U0001/design.md', content: '# Design' },
        { relPath: '.dev-state/U0001.json', content: '{}' },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.filesWritten).toBe(2)
    expect(fs.readFileSync(path.join(root, 'tasks/U0001/design.md'), 'utf8')).toBe('# Design')
    expect(fs.readFileSync(path.join(root, '.dev-state/U0001.json'), 'utf8')).toBe('{}')
  })

  test('overwrites existing file content', async () => {
    await writeArtifacts({ projectRoot: root, files: [{ relPath: 'pipeline.yaml', content: 'v1' }] })
    const result = await writeArtifacts({ projectRoot: root, files: [{ relPath: 'pipeline.yaml', content: 'v2' }] })
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'pipeline.yaml'), 'utf8')).toBe('v2')
  })

  test('prunes orphan files under tasks/ not present in new request', async () => {
    await writeArtifacts({
      projectRoot: root,
      files: [
        { relPath: 'tasks/U0001/design.md', content: 'old' },
        { relPath: 'tasks/U0002/design.md', content: 'keep' },
      ],
    })
    const result = await writeArtifacts({
      projectRoot: root,
      files: [{ relPath: 'tasks/U0002/design.md', content: 'keep' }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.filesDeleted).toBe(1)
    expect(fs.existsSync(path.join(root, 'tasks/U0001'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'tasks/U0002/design.md'))).toBe(true)
  })

  test('does not prune files outside ARTIFACT_SYNC_PRUNE_PREFIXES', async () => {
    await writeArtifacts({ projectRoot: root, files: [{ relPath: 'knowledge/foo.md', content: 'a' }] })
    const result = await writeArtifacts({ projectRoot: root, files: [] })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'knowledge/foo.md'))).toBe(true)
  })

  test('rejects entire batch when one path is invalid — nothing written', async () => {
    const result = await writeArtifacts({
      projectRoot: root,
      files: [
        { relPath: 'tasks/U0001/design.md', content: 'ok' },
        { relPath: '../escape.md', content: 'bad' },
      ],
    })
    expect(result.ok).toBe(false)
    expect(fs.existsSync(path.join(root, 'tasks/U0001/design.md'))).toBe(false)
  })

  test('empty files array is valid — a no-op snapshot', async () => {
    const result = await writeArtifacts({ projectRoot: root, files: [] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.filesWritten).toBe(0)
      expect(result.filesDeleted).toBe(0)
    }
  })

  test('rejects symlink escape under project root', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-sync-outside-'))
    fs.mkdirSync(path.join(root, 'tasks'), { recursive: true })
    fs.rmSync(path.join(root, 'tasks'), { recursive: true, force: true })
    fs.symlinkSync(outside, path.join(root, 'tasks'), 'dir')

    const result = await writeArtifacts({
      projectRoot: root,
      files: [{ relPath: 'tasks/U0001/design.md', content: 'evil' }],
    })
    expect(result.ok).toBe(false)
    fs.rmSync(outside, { recursive: true, force: true })
  })
})

describe('collectArtifactFiles', () => {
  test('reads exact files + prefixes from disk, skips missing optional files', () => {
    fs.mkdirSync(path.join(root, 'tasks', 'U0001'), { recursive: true })
    fs.writeFileSync(path.join(root, 'tasks', 'U0001', 'design.md'), '# Design')
    fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
    fs.writeFileSync(path.join(root, '.dev-state', 'U0001.json'), '{}')
    fs.writeFileSync(path.join(root, 'pipeline.yaml'), 'steps: []')
    // knowledge.config.yaml / project-rules.md intentionally absent.

    const files = collectArtifactFiles(root)
    const byPath = Object.fromEntries(files.map((f) => [f.relPath, f.content]))
    expect(byPath['tasks/U0001/design.md']).toBe('# Design')
    expect(byPath['.dev-state/U0001.json']).toBe('{}')
    expect(byPath['pipeline.yaml']).toBe('steps: []')
    expect(byPath['knowledge.config.yaml']).toBeUndefined()
    expect(byPath['project-rules.md']).toBeUndefined()
  })
})
