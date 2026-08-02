import { describe, expect, it } from 'vitest'
import { sanitiseProfileName } from '@/features/pipeline-editor/business/pipeline'

describe('sanitiseProfileName', () => {
  it('keeps allowed chars (alnum, _-. and space)', () => {
    expect(sanitiseProfileName('My Profile_1-2.x')).toBe('My Profile_1-2.x')
  })
  it('strips disallowed chars', () => {
    expect(sanitiseProfileName('a@b#c')).toBe('abc')
  })
  it('rejects path separators and null bytes', () => {
    expect(sanitiseProfileName('a/b')).toBeNull()
    expect(sanitiseProfileName('a\\b')).toBeNull()
    expect(sanitiseProfileName('a\0b')).toBeNull()
  })
  it('rejects non-strings and blanks', () => {
    expect(sanitiseProfileName(123 as unknown as string)).toBeNull()
    expect(sanitiseProfileName('   ')).toBeNull()
  })
  it('caps length at 64', () => {
    expect(sanitiseProfileName('a'.repeat(100))).toHaveLength(64)
  })
})
