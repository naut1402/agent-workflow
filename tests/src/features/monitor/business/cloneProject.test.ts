import { describe, expect, test } from 'bun:test'
import {
  githubGitAuthExtraHeader,
  normaliseGithubCloneUrl,
} from '@/features/monitor/business/projects/cloneProject'

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
