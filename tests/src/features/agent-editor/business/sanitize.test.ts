import { describe, expect, it } from 'vitest'
import { sanitiseAgentName } from '@/features/agent-editor/business/agents'
import { isPrivateHostname } from '@/features/agent-editor/business/agents'

describe('sanitiseAgentName', () => {
  it('allows only alnum, underscore and dash (no dots/spaces)', () => {
    expect(sanitiseAgentName('agent_name-1')).toBe('agent_name-1')
    expect(sanitiseAgentName('a.b c')).toBe('abc')
  })
  it('rejects path separators', () => {
    expect(sanitiseAgentName('../x')).toBeNull()
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
