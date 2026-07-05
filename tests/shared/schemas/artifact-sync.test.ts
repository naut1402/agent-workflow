import { describe, expect, it } from 'vitest'
import {
  ArtifactFileSchema,
  SyncArtifactsRequestSchema,
  isArtifactPathAllowed,
} from '../../../shared/schemas/artifact-sync'

describe('isArtifactPathAllowed', () => {
  it('accepts exact whitelisted files', () => {
    expect(isArtifactPathAllowed('pipeline.yaml')).toBe(true)
    expect(isArtifactPathAllowed('knowledge.config.yaml')).toBe(true)
    expect(isArtifactPathAllowed('project-rules.md')).toBe(true)
  })
  it('accepts files under whitelisted prefixes', () => {
    expect(isArtifactPathAllowed('.dev-state/U0001.json')).toBe(true)
    expect(isArtifactPathAllowed('tasks/U0001/design.md')).toBe(true)
    expect(isArtifactPathAllowed('knowledge/foo.md')).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isArtifactPathAllowed('random.txt')).toBe(false)
    expect(isArtifactPathAllowed('orchestrator-remote.json')).toBe(false)
    expect(isArtifactPathAllowed('.dev-team-agent/tasks/U0001/design.md')).toBe(false)
  })
})

describe('ArtifactFileSchema', () => {
  it('accepts a small text file', () => {
    expect(ArtifactFileSchema.safeParse({ relPath: 'tasks/U0001/design.md', content: '# Design' }).success).toBe(
      true,
    )
  })
  it('rejects empty relPath', () => {
    expect(ArtifactFileSchema.safeParse({ relPath: '', content: 'x' }).success).toBe(false)
  })
  it('rejects content over 5MB', () => {
    const big = 'a'.repeat(5_000_001)
    expect(ArtifactFileSchema.safeParse({ relPath: 'tasks/x.md', content: big }).success).toBe(false)
  })
})

describe('SyncArtifactsRequestSchema', () => {
  it('accepts empty files array', () => {
    expect(SyncArtifactsRequestSchema.safeParse({ files: [] }).success).toBe(true)
  })
  it('rejects more than 2000 files', () => {
    const files = Array.from({ length: 2001 }, (_, i) => ({ relPath: `tasks/${i}.md`, content: 'x' }))
    expect(SyncArtifactsRequestSchema.safeParse({ files }).success).toBe(false)
  })
})
