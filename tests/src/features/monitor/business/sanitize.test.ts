import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { resolveArtifact } from '@/features/monitor/business/tasks'

describe('resolveArtifact', () => {
  const root = path.resolve('/data/root')
  it('resolves a file inside the task dir', () => {
    const r = resolveArtifact(root, 'B4488', 'design.md')
    expect(r).toBe(path.resolve(root, 'tasks', 'B4488', 'design.md'))
  })
  it('returns null on path traversal', () => {
    expect(resolveArtifact(root, 'B4488', '../../etc/passwd')).toBeNull()
    expect(resolveArtifact(root, 'B4488', '..')).toBeNull()
  })
})
