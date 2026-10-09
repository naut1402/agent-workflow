import { describe, expect, it } from 'vitest'
import { sanitiseAgentName } from '@/features/agent-editor/business/agents'

describe('sanitiseAgentName', () => {
  it('allows only alnum, underscore and dash (no dots/spaces)', () => {
    expect(sanitiseAgentName('agent_name-1')).toBe('agent_name-1')
    expect(sanitiseAgentName('a.b c')).toBe('abc')
  })
  it('rejects path separators', () => {
    expect(sanitiseAgentName('../x')).toBeNull()
  })
})

// `isPrivateHostname` đã dời về `src/backend/lib/netUtils.ts` (Tcebe274e-P3) —
// bộ ca của nó ở `tests/src/backend/lib/netUtils.test.ts`.
