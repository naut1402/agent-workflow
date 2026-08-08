import { describe, expect, test } from 'bun:test'
import { normaliseGithubCloneUrl } from '@/features/monitor/business/projects/cloneProject'

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
