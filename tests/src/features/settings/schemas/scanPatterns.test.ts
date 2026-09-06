import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCAN_PATTERNS_CONFIG,
  SCAN_PATTERN_KINDS,
  SCAN_PATTERN_MAX_COUNT,
  SCAN_PATTERN_MAX_LENGTH,
  hasAnyScanPattern,
  parseScanPatternsConfig,
  sanitiseScanPattern,
} from '@/features/settings/schemas/scanPatterns'

describe('sanitiseScanPattern', () => {
  it('trims, normalises separators and collapses slashes', () => {
    expect(sanitiseScanPattern('  .agents/*.md  ')).toBe('.agents/*.md')
    expect(sanitiseScanPattern('packages\\*\\skills')).toBe('packages/*/skills')
    expect(sanitiseScanPattern('docs//agent-rules')).toBe('docs/agent-rules')
  })

  it('strips leading ./ and trailing slashes', () => {
    expect(sanitiseScanPattern('./docs/rules/')).toBe('docs/rules')
    expect(sanitiseScanPattern('././tools')).toBe('tools')
    expect(sanitiseScanPattern('tools///')).toBe('tools')
  })

  it('keeps wildcards untouched', () => {
    expect(sanitiseScanPattern('**/rules')).toBe('**/rules')
    expect(sanitiseScanPattern('agent?.md')).toBe('agent?.md')
  })

  it('rejects empty, non-string and dot-only input', () => {
    expect(sanitiseScanPattern('')).toBeNull()
    expect(sanitiseScanPattern('   ')).toBeNull()
    expect(sanitiseScanPattern('.')).toBeNull()
    expect(sanitiseScanPattern('./')).toBeNull()
    expect(sanitiseScanPattern(42)).toBeNull()
    expect(sanitiseScanPattern(null)).toBeNull()
    expect(sanitiseScanPattern(['x'])).toBeNull()
  })

  it('rejects absolute paths, drive letters, ~ and ..', () => {
    expect(sanitiseScanPattern('/etc')).toBeNull()
    expect(sanitiseScanPattern('C:\\Windows')).toBeNull()
    expect(sanitiseScanPattern('~/.claude/agents')).toBeNull()
    expect(sanitiseScanPattern('../outside')).toBeNull()
    expect(sanitiseScanPattern('docs/../../etc')).toBeNull()
  })

  it('rejects patterns longer than the max length', () => {
    expect(sanitiseScanPattern('a'.repeat(SCAN_PATTERN_MAX_LENGTH))).toBe(
      'a'.repeat(SCAN_PATTERN_MAX_LENGTH),
    )
    expect(sanitiseScanPattern('a'.repeat(SCAN_PATTERN_MAX_LENGTH + 1))).toBeNull()
  })
})

describe('parseScanPatternsConfig', () => {
  it('always returns all three kinds', () => {
    expect(parseScanPatternsConfig(undefined)).toEqual(DEFAULT_SCAN_PATTERNS_CONFIG)
    expect(parseScanPatternsConfig(null)).toEqual({ agents: [], skills: [], rules: [] })
    expect(parseScanPatternsConfig('nope')).toEqual({ agents: [], skills: [], rules: [] })
    expect(Object.keys(parseScanPatternsConfig({ agents: ['a'] })).sort()).toEqual(
      [...SCAN_PATTERN_KINDS].sort(),
    )
  })

  it('keeps kinds independent', () => {
    const cfg = parseScanPatternsConfig({
      agents: ['.agents/*.md'],
      skills: ['packages/*/skills'],
      rules: ['docs/rules'],
    })
    expect(cfg).toEqual({
      agents: ['.agents/*.md'],
      skills: ['packages/*/skills'],
      rules: ['docs/rules'],
    })
  })

  it('drops junk entries and dedupes after normalising', () => {
    const cfg = parseScanPatternsConfig({
      agents: ['./tools/', 'tools', '/abs', '../up', '', 7, 'tools/x'],
    })
    expect(cfg.agents).toEqual(['tools', 'tools/x'])
  })

  it('caps each kind at SCAN_PATTERN_MAX_COUNT', () => {
    const many = Array.from({ length: SCAN_PATTERN_MAX_COUNT + 5 }, (_, i) => `dir${i}`)
    expect(parseScanPatternsConfig({ rules: many }).rules).toHaveLength(SCAN_PATTERN_MAX_COUNT)
  })

  it('treats a non-array kind as empty', () => {
    expect(parseScanPatternsConfig({ agents: 'x', skills: null, rules: {} })).toEqual({
      agents: [],
      skills: [],
      rules: [],
    })
  })
})

describe('hasAnyScanPattern', () => {
  it('is false for empty / missing config', () => {
    expect(hasAnyScanPattern(null)).toBe(false)
    expect(hasAnyScanPattern(undefined)).toBe(false)
    expect(hasAnyScanPattern({ agents: [], skills: [], rules: [] })).toBe(false)
  })

  it('is true when any kind has a pattern', () => {
    expect(hasAnyScanPattern({ agents: ['x'], skills: [], rules: [] })).toBe(true)
    expect(hasAnyScanPattern({ agents: [], skills: [], rules: ['y'] })).toBe(true)
  })
})
