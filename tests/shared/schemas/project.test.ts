import { describe, expect, it } from 'vitest'
import {
  AddProjectRequest,
  GitSource,
  Project,
  ProjectKind,
  normalizeProject,
  parseAddProjectRequest,
} from '../../../shared/schemas/project'

describe('ProjectKind', () => {
  it('accepts local and git', () => {
    expect(ProjectKind.parse('local')).toBe('local')
    expect(ProjectKind.parse('git')).toBe('git')
  })
})

describe('normalizeProject', () => {
  it('fills missing kind as local', () => {
    const p = normalizeProject({
      id: 'a',
      name: 'A',
      path: '/x/.dev-team-agent',
      addedAt: 't',
      default: true,
    })
    expect(p.kind).toBe('local')
    expect(p.source).toBeUndefined()
  })

  it('preserves git source', () => {
    const p = normalizeProject({
      id: 'g',
      name: 'G',
      kind: 'git',
      path: '/x/.dev-team-agent',
      addedAt: 't',
      default: false,
      source: {
        type: 'git',
        url: 'https://github.com/org/repo',
        branch: 'main',
        lastSyncAt: '2020-01-01T00:00:00.000Z',
      },
    })
    expect(p.kind).toBe('git')
    expect(GitSource.parse(p.source).branch).toBe('main')
  })
})

describe('AddProjectRequest', () => {
  it('requires exactly one of path or gitUrl', () => {
    expect(parseAddProjectRequest({ path: '/a' }).success).toBe(true)
    expect(parseAddProjectRequest({ gitUrl: 'https://github.com/a/b.git' }).success).toBe(true)
    expect(parseAddProjectRequest({}).success).toBe(false)
    expect(parseAddProjectRequest({ path: '/a', gitUrl: 'https://x' }).success).toBe(false)
  })
})

describe('Project schema', () => {
  it('parses full git project', () => {
    const p = Project.parse({
      id: 'repo-abc',
      name: 'repo',
      kind: 'git',
      path: '/w/.dev-team-agent',
      addedAt: 't',
      default: false,
      source: { type: 'git', url: 'https://github.com/o/r', branch: 'main' },
    })
    expect(p.kind).toBe('git')
  })
})
