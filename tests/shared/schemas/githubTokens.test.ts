import { describe, expect, it } from 'vitest'
import {
  normaliseRepoSlug,
  parseGithubTokensConfig,
  resolveGithubTokenForRepo,
} from '../../../shared/schemas/githubTokens'

describe('parseGithubTokensConfig', () => {
  it('returns empty repos for invalid input', () => {
    expect(parseGithubTokensConfig(null)).toEqual({ repos: [] })
    expect(parseGithubTokensConfig('x')).toEqual({ repos: [] })
  })

  it('normalises slugs and dedupes (last wins)', () => {
    const parsed = parseGithubTokensConfig({
      repos: [
        { repo: 'Owner/Repo', token: 'tok-a' },
        { repo: 'owner/repo', token: 'tok-b' },
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
  it('lowercases and trims slashes', () => {
    expect(normaliseRepoSlug(' /Owner/Repo/ ')).toBe('owner/repo')
  })
})
