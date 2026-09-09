import { describe, expect, test } from 'bun:test'
import { resolveCorsHeaders } from '../../../../../src/core/http/security/corsGuard'
import type { CorsConfig } from '../../../../../src/features/settings/schemas/security'

const baseConfig: CorsConfig = {
  enabled: true,
  allowedOrigins: ['https://allowed.example'],
  allowCredentials: false,
}

describe('resolveCorsHeaders', () => {
  test('disabled → null', () => {
    expect(resolveCorsHeaders('https://allowed.example', { ...baseConfig, enabled: false })).toBeNull()
  })

  test('no Origin header → null', () => {
    expect(resolveCorsHeaders(undefined, baseConfig)).toBeNull()
  })

  test('origin not in allowlist → null', () => {
    expect(resolveCorsHeaders('https://not-allowed.example', baseConfig)).toBeNull()
  })

  test('allowedOrigins empty even if enabled → null (deny-by-default)', () => {
    expect(resolveCorsHeaders('https://allowed.example', { ...baseConfig, allowedOrigins: [] })).toBeNull()
  })

  test('matching origin → Allow-Origin header, no credentials header by default', () => {
    const headers = resolveCorsHeaders('https://allowed.example', baseConfig)
    expect(headers).toEqual({ 'Access-Control-Allow-Origin': 'https://allowed.example', Vary: 'Origin' })
  })

  test('allowCredentials=true → adds Allow-Credentials, origin stays specific (not *)', () => {
    const headers = resolveCorsHeaders('https://allowed.example', { ...baseConfig, allowCredentials: true })
    expect(headers).toEqual({
      'Access-Control-Allow-Origin': 'https://allowed.example',
      Vary: 'Origin',
      'Access-Control-Allow-Credentials': 'true',
    })
  })
})
