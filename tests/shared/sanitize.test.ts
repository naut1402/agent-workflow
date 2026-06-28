import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  isPrivateHostname,
  resolveArtifact,
  sanitiseAgentName,
  sanitiseProfileName,
} from '../../shared/sanitize'

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

describe('sanitiseAgentName', () => {
  it('allows only alnum, underscore and dash (no dots/spaces)', () => {
    expect(sanitiseAgentName('agent_name-1')).toBe('agent_name-1')
    expect(sanitiseAgentName('a.b c')).toBe('abc') // dot and space stripped, letters kept
  })
  it('rejects path separators', () => {
    expect(sanitiseAgentName('../x')).toBeNull()
  })
})

describe('resolveArtifact', () => {
  const root = path.resolve('/data/root')
  it('resolves a file inside the task dir', () => {
    const r = resolveArtifact(root, 'B4488', 'design.md')
    expect(r).toBe(path.resolve(root, 'tasks', 'B4488', 'design.md'))
  })
  it('returns null on path traversal', () => {
    expect(resolveArtifact(root, 'B4488', '../../etc/passwd')).toBeNull()
    expect(resolveArtifact(root, 'B4488', '..')).toBeNull()
  })
})

describe('isPrivateHostname', () => {
  it.each(['localhost', 'foo.local', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.255'])(
    'treats %s as private',
    (h) => expect(isPrivateHostname(h)).toBe(true),
  )
  it.each(['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1'])(
    'treats %s as public',
    (h) => expect(isPrivateHostname(h)).toBe(false),
  )
})
