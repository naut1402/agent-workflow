import { describe, expect, test } from 'bun:test'
import { fetchUrlSafe } from '../../../../src/features/agent-editor/business/fetch'

// These assert the SSRF/protocol guards which reject BEFORE any network call.
describe('fetchUrlSafe guards', () => {
  test('rejects an invalid URL', async () => {
    await expect(fetchUrlSafe('not a url')).rejects.toThrow('invalid URL')
  })
  test('rejects non-https protocols', async () => {
    await expect(fetchUrlSafe('http://example.com')).rejects.toThrow('only https')
  })
  test('rejects private/loopback hosts', async () => {
    await expect(fetchUrlSafe('https://localhost/x')).rejects.toThrow('private hosts')
    await expect(fetchUrlSafe('https://127.0.0.1/x')).rejects.toThrow('private hosts')
    await expect(fetchUrlSafe('https://192.168.1.1/x')).rejects.toThrow('private hosts')
  })
})
