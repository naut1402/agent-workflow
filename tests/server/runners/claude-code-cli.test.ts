import { describe, expect, test } from 'bun:test'
import { resolveEffectiveFlags } from '../../../server/runners/flagUtils.js'
import type { CredentialProfile } from '../../../server/runners/types.js'

const envCredential: CredentialProfile = {
  id: 'claude-server-env',
  provider: 'claude-code-cli',
  label: 'Anthropic API Key (env)',
  secretRef: 'env:ANTHROPIC_API_KEY',
}

const cliSessionCredential: CredentialProfile = {
  id: 'claude-default',
  provider: 'claude-code-cli',
  label: 'Claude Code (logged-in CLI)',
  secretRef: 'cli-session',
}

describe('resolveEffectiveFlags', () => {
  test('keeps --bare with env credential', () => {
    expect(resolveEffectiveFlags(['--bare'], envCredential)).toEqual(['--bare'])
  })

  test('strips --bare with cli-session credential', () => {
    expect(resolveEffectiveFlags(['--bare', '--other'], cliSessionCredential)).toEqual(['--other'])
  })

  test('handles non-array flags', () => {
    expect(resolveEffectiveFlags(undefined, envCredential)).toEqual([])
  })
})
