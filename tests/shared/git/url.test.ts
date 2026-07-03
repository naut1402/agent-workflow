import { describe, expect, it } from 'vitest'
import { validateGitUrl } from '../../../shared/git/url'

describe('validateGitUrl', () => {
  it('accepts public https URL', () => {
    const r = validateGitUrl('https://github.com/org/repo.git')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.normalizedUrl).toBe('https://github.com/org/repo.git')
    }
  })

  it('normalizes trailing slash on path', () => {
    const r = validateGitUrl('https://github.com/org/repo.git/')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.normalizedUrl).toBe('https://github.com/org/repo.git')
  })

  it('rejects http', () => {
    const r = validateGitUrl('http://github.com/org/repo.git')
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toBe('only https URLs allowed')
  })

  it('rejects private hosts', () => {
    expect(validateGitUrl('https://127.0.0.1/repo.git').ok).toBe(false)
    expect(validateGitUrl('https://localhost/repo.git').ok).toBe(false)
  })

  it('rejects empty', () => {
    expect(validateGitUrl('  ').ok).toBe(false)
  })
})
