import { describe, expect, it } from 'vitest'
import {
  AddApiProjectBodySchema,
  AddProjectRequest,
  GitSource,
  Project,
  ProjectKind,
  normalizeProject,
  parseAddProjectRequest,
} from '../../../shared/schemas/project'

describe('ProjectKind', () => {
  it('accepts local, git, ssh, api', () => {
    expect(ProjectKind.parse('local')).toBe('local')
    expect(ProjectKind.parse('git')).toBe('git')
    expect(ProjectKind.parse('ssh')).toBe('ssh')
    expect(ProjectKind.parse('api')).toBe('api')
  })
})

describe('AddApiProjectBodySchema', () => {
  it('accepts minimal body (kind only)', () => {
    expect(AddApiProjectBodySchema.safeParse({ kind: 'api' }).success).toBe(true)
  })
  it('accepts optional sourceUrl/branch/name', () => {
    const parsed = AddApiProjectBodySchema.safeParse({
      kind: 'api',
      name: 'My Project',
      sourceUrl: 'https://github.com/org/repo.git',
      branch: 'main',
    })
    expect(parsed.success).toBe(true)
  })
  it('rejects wrong kind literal', () => {
    expect(AddApiProjectBodySchema.safeParse({ kind: 'git' }).success).toBe(false)
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

  it('preserves apiSync for kind api, drops it for other kinds', () => {
    const api = normalizeProject({
      id: 'a',
      name: 'A',
      kind: 'api',
      path: '/x/.dev-team-agent',
      addedAt: 't',
      default: false,
      apiSync: { lastSyncedAt: '2020-01-01T00:00:00.000Z' },
    })
    expect(api.kind).toBe('api')
    expect(api.apiSync?.lastSyncedAt).toBe('2020-01-01T00:00:00.000Z')

    const local = normalizeProject({
      id: 'b',
      name: 'B',
      kind: 'local',
      path: '/y/.dev-team-agent',
      addedAt: 't',
      default: false,
      apiSync: { lastSyncedAt: '2020-01-01T00:00:00.000Z' },
    })
    expect(local.apiSync).toBeUndefined()
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
