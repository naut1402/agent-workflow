import { describe, expect, it } from 'vitest'
import {
  normaliseRepoSlug,
  parseGithubRepoRef,
  parseGithubTokensConfig,
  resolveGithubTokenForRepo,
} from '@shared/schemas/githubTokens'

describe('parseGithubRepoRef', () => {
  it('accepts bare owner/repo', () => {
    expect(parseGithubRepoRef('Owner/Repo')).toBe('owner/repo')
  })

  it('accepts HTTPS repo / issue / .git URLs', () => {
    expect(parseGithubRepoRef('https://github.com/Owner/Repo')).toBe('owner/repo')
    expect(parseGithubRepoRef('https://github.com/Owner/Repo/')).toBe('owner/repo')
    expect(parseGithubRepoRef('https://www.github.com/Owner/Repo.git')).toBe('owner/repo')
    expect(parseGithubRepoRef('https://github.com/Owner/Repo/issues/42')).toBe('owner/repo')
    expect(parseGithubRepoRef('https://github.com/Owner/Repo/pull/9#discussion')).toBe('owner/repo')
  })

  it('accepts SSH URLs', () => {
    expect(parseGithubRepoRef('git@github.com:Owner/Repo.git')).toBe('owner/repo')
  })

  it('rejects non-github refs', () => {
    expect(parseGithubRepoRef('bad')).toBeNull()
    expect(parseGithubRepoRef('https://gitlab.com/o/r')).toBeNull()
    expect(parseGithubRepoRef('')).toBeNull()
  })
})

describe('parseGithubTokensConfig', () => {
  it('returns empty repos for invalid input', () => {
    expect(parseGithubTokensConfig(null)).toEqual({ repos: [] })
    expect(parseGithubTokensConfig('x')).toEqual({ repos: [] })
  })

  it('normalises slugs/URLs and dedupes (last wins)', () => {
    const parsed = parseGithubTokensConfig({
      repos: [
        { repo: 'Owner/Repo', token: 'tok-a' },
        { repo: 'https://github.com/owner/repo/issues/1', token: 'tok-b' },
        { repo: 'bad', token: 'x' },
        { repo: 'other/repo', token: '  tok-c  ' },
      ],
    })
    expect(parsed.repos).toEqual([
      { repo: 'owner/repo', token: 'tok-b' },
      { repo: 'other/repo', token: 'tok-c' },
    ])
  })
})

describe('resolveGithubTokenForRepo', () => {
  it('prefers matching per-repo token over env', () => {
    const token = resolveGithubTokenForRepo(
      { repos: [{ repo: 'acme/app', token: 'repo-tok' }] },
      'Acme',
      'App',
      'env-tok',
    )
    expect(token).toBe('repo-tok')
  })

  it('falls back to env token when no match', () => {
    expect(
      resolveGithubTokenForRepo({ repos: [] }, 'o', 'r', 'env-tok'),
    ).toBe('env-tok')
    expect(resolveGithubTokenForRepo({ repos: [] }, 'o', 'r', null)).toBeNull()
  })
})

describe('normaliseRepoSlug', () => {
  it('parses URLs to owner/repo', () => {
    expect(normaliseRepoSlug('https://github.com/Owner/Repo')).toBe('owner/repo')
    expect(normaliseRepoSlug(' /Owner/Repo/ ')).toBe('owner/repo')
  })
})
