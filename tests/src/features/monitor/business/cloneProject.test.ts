import { describe, expect, test } from 'bun:test'
import {
  githubGitAuthExtraHeader,
  isGithubGitRemote,
  normaliseGithubCloneUrl,
  resolveCloneAuth,
  sanitiseGitUrl,
} from '@/features/monitor/business/projects/cloneProject'

describe('sanitiseGitUrl', () => {
  test('accepts public https and github ssh', () => {
    expect(sanitiseGitUrl('https://github.com/naut1402/agent-workflow')).toContain('github.com')
    expect(sanitiseGitUrl('git@github.com:naut1402/agent-workflow.git')).toContain('git@github.com')
  })

  test('rejects userinfo, private hosts, and junk', () => {
    expect(sanitiseGitUrl('https://user:token@github.com/o/r')).toBeNull()
    expect(sanitiseGitUrl('https://127.0.0.1/o/r')).toBeNull()
    expect(sanitiseGitUrl('https://10.0.0.5/o/r')).toBeNull()
    expect(sanitiseGitUrl('git@192.168.1.1:o/r.git')).toBeNull()
    expect(sanitiseGitUrl('https://evil.example/o/r')).toContain('evil.example')
    expect(sanitiseGitUrl('not-a-url')).toBeNull()
  })
})

describe('isGithubGitRemote / resolveCloneAuth', () => {
  test('only github remotes are github remotes', () => {
    expect(isGithubGitRemote('https://github.com/o/r')).toBe(true)
    expect(isGithubGitRemote('git@github.com:o/r.git')).toBe(true)
    expect(isGithubGitRemote('https://evil.example/o/r')).toBe(false)
    expect(isGithubGitRemote('https://gitlab.com/o/r')).toBe(false)
  })

  test('non-github host never gets Authorization header', () => {
    const auth = resolveCloneAuth('https://evil.example/owner/repo')
    expect(auth.extraHeader).toBeNull()
    expect(auth.usedToken).toBe(false)
    expect(auth.cloneUrl).toBe('https://evil.example/owner/repo')
  })
})

describe('normaliseGithubCloneUrl', () => {
  test('keeps full repo name when HTTPS URL has no .git suffix', () => {
    // Regression: non-anchored non-greedy match truncated `agent-workflow` → `a`
    expect(
      normaliseGithubCloneUrl('https://github.com/naut1402/agent-workflow', 'naut1402', 'agent-workflow'),
    ).toBe('https://github.com/naut1402/agent-workflow.git')
  })

  test('normalises HTTPS URL that already has .git', () => {
    expect(
      normaliseGithubCloneUrl(
        'https://github.com/naut1402/agent-workflow.git',
        'naut1402',
        'agent-workflow',
      ),
    ).toBe('https://github.com/naut1402/agent-workflow.git')
  })

  test('converts SSH github URL to HTTPS .git', () => {
    expect(
      normaliseGithubCloneUrl('git@github.com:naut1402/agent-workflow.git', 'naut1402', 'agent-workflow'),
    ).toBe('https://github.com/naut1402/agent-workflow.git')
  })

  test('leaves non-github URL unchanged', () => {
    const url = 'https://gitlab.com/o/r.git'
    expect(normaliseGithubCloneUrl(url, 'o', 'r')).toBe(url)
  })
})

describe('githubGitAuthExtraHeader', () => {
  test('uses Basic x-access-token (not Bearer) for git Smart HTTP', () => {
    const header = githubGitAuthExtraHeader('ghp_test_token')
    expect(header.startsWith('Authorization: Basic ')).toBe(true)
    expect(header.includes('Bearer')).toBe(false)
    const b64 = header.slice('Authorization: Basic '.length)
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('x-access-token:ghp_test_token')
  })

  test('strips CR/LF/NUL from token before encoding', () => {
    const header = githubGitAuthExtraHeader('ghp_a\r\nb\0c')
    const b64 = header.slice('Authorization: Basic '.length)
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('x-access-token:ghp_abc')
  })
})
