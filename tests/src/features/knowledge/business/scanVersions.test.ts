import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeTextFileSync, joinPath } from '../../../../../src/core/lib/fileHelper.js'
import os from 'node:os'
import { scanProjectDocuments, readCandidateContent } from '../../../../../src/features/knowledge/business/scanDocs.js'
import {
  snapshotKnowledgeRevision,
  listKnowledgeRevisions,
  restoreKnowledgeRevision,
} from '../../../../../src/features/knowledge/business/versions.js'
import { knowledgeRoot } from '../../../../../src/features/knowledge/business/fileDriver.js'

describe('knowledge scan + versions', () => {
  test('scan finds markdown under docs/', () => {
    const root = joinPath(os.tmpdir(), `scan-${Date.now()}`)
    mkdirSync(joinPath(root, 'docs'), { recursive: true })
    writeTextFileSync(joinPath(root, 'docs', 'guide.md'), '# Guide\nhello')
    const { candidates } = scanProjectDocuments(root)
    expect(candidates.some((c) => c.relativePath.replace(/\\/g, '/').endsWith('docs/guide.md'))).toBe(true)
    const content = readCandidateContent(root, 'docs/guide.md')
    expect(content).toContain('hello')
  })

  test('snapshot and restore revision', () => {
    const devTeam = joinPath(os.tmpdir(), `know-${Date.now()}`, '.dev-team-agent')
    const scope = 'project'
    const slug = 'note'
    const file = joinPath(knowledgeRoot(devTeam), scope, `${slug}.md`)
    mkdirSync(joinPath(knowledgeRoot(devTeam), scope), { recursive: true })
    writeTextFileSync(file, 'v1')
    const snap = snapshotKnowledgeRevision(devTeam, scope, slug)
    expect(snap).toBeTruthy()
    writeTextFileSync(file, 'v2')
    const revs = listKnowledgeRevisions(devTeam, scope, slug)
    expect(revs.length).toBeGreaterThanOrEqual(1)
    const restored = restoreKnowledgeRevision(devTeam, scope, slug, snap!.id)
    expect(restored.ok).toBe(true)
  })
})
