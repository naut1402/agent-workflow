import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildIssuePrompt,
  fetchGithubIssue,
  parseGithubIssueUrl,
} from '../../../server/github/issue'

const originalFetch = globalThis.fetch
let savedToken: string | undefined

afterEach(() => {
  globalThis.fetch = originalFetch
  if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken
  else delete process.env.GITHUB_TOKEN
  savedToken = undefined
})

describe('parseGithubIssueUrl', () => {
  test('parses a standard GitHub issue URL', () => {
    expect(parseGithubIssueUrl('https://github.com/naut1402/agent-workflow/issues/144')).toEqual({
      owner: 'naut1402',
      repo: 'agent-workflow',
      number: 144,
    })
  })

  test('accepts trailing slash and hash fragment', () => {
    expect(parseGithubIssueUrl('https://github.com/o/r/issues/9/#comment')).toEqual({
      owner: 'o',
      repo: 'r',
      number: 9,
    })
  })

  test('rejects non-issue URLs', () => {
    expect(parseGithubIssueUrl('https://github.com/o/r/pull/1')).toBeNull()
    expect(parseGithubIssueUrl('not-a-url')).toBeNull()
    expect(parseGithubIssueUrl('http://github.com/o/r/issues/1')).toBeNull()
  })
})

describe('buildIssuePrompt', () => {
  test('includes title, source link, and body', () => {
    const prompt = buildIssuePrompt({
      title: 'Fix bug',
      body: 'Steps to reproduce',
      url: 'https://github.com/o/r/issues/1',
    })
    expect(prompt).toContain('# Fix bug')
    expect(prompt).toContain('Nguồn: https://github.com/o/r/issues/1')
    expect(prompt).toContain('Steps to reproduce')
  })
})

describe('fetchGithubIssue', () => {
  test('returns issue preview from GitHub API', async () => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.github.com/repos/o/r/issues/42')
      expect((init?.headers as Record<string, string>)?.Accept).toBe('application/vnd.github+json')
      return new Response(
        JSON.stringify({
          number: 42,
          title: 'Hello',
          body: 'World',
          labels: [{ name: 'bug' }],
          html_url: 'https://github.com/o/r/issues/42',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const result = await fetchGithubIssue('https://github.com/o/r/issues/42')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issue.number).toBe(42)
    expect(result.issue.labels).toEqual(['bug'])
    expect(result.issue.prompt).toContain('# Hello')
  })

  test('sends Authorization when GITHUB_TOKEN is set', async () => {
    savedToken = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'gh_test_token'
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer gh_test_token')
      return new Response(
        JSON.stringify({
          number: 1,
          title: 'T',
          body: null,
          labels: [],
          html_url: 'https://github.com/o/r/issues/1',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const result = await fetchGithubIssue('https://github.com/o/r/issues/1')
    expect(result.ok).toBe(true)
  })

  test('400 for invalid issue URL', async () => {
    const result = await fetchGithubIssue('https://example.com/not-github')
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(400)
  })

  test('404 when GitHub API returns not found', async () => {
    globalThis.fetch = (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch
    const result = await fetchGithubIssue('https://github.com/o/r/issues/999')
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(404)
  })
})
