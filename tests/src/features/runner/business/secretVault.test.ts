import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deleteSecret, hasVaultKey, readSecret, storeSecret } from '../../../../../src/features/runner/business/secretVault.js'

let home: string
const savedEnv = { ...process.env }

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-secret-vault-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  fs.rmSync(path.join(home, 'secret-vault.json'), { force: true })
})

describe('secretVault — hasVaultKey', () => {
  test('false when DASHBOARD_SECRET_KEY unset, true when set', () => {
    delete process.env.DASHBOARD_SECRET_KEY
    expect(hasVaultKey()).toBe(false)
    process.env.DASHBOARD_SECRET_KEY = 'x'
    expect(hasVaultKey()).toBe(true)
    delete process.env.DASHBOARD_SECRET_KEY
  })
})

describe('secretVault — store/read/delete round trip', () => {
  beforeEach(() => {
    process.env.DASHBOARD_SECRET_KEY = 'test-passphrase-not-hex'
  })

  test('stores and reads back an encrypted payload', () => {
    storeSecret('cred-1', { value: 'sk-super-secret' })
    expect(readSecret<{ value: string }>('cred-1')).toEqual({ value: 'sk-super-secret' })
  })

  test('the on-disk file never contains the plaintext value', () => {
    storeSecret('cred-2', { value: 'plaintext-marker-xyz' })
    const raw = fs.readFileSync(path.join(home, 'secret-vault.json'), 'utf8')
    expect(raw).not.toContain('plaintext-marker-xyz')
  })

  test('readSecret returns null for a missing id', () => {
    expect(readSecret('does-not-exist')).toBeNull()
  })

  test('accepts a 64-hex-char key as raw bytes instead of hashing it', () => {
    process.env.DASHBOARD_SECRET_KEY = 'a'.repeat(64)
    storeSecret('cred-hex', { value: 'v' })
    expect(readSecret<{ value: string }>('cred-hex')).toEqual({ value: 'v' })
  })

  test('deleteSecret removes the entry; a second delete is a no-op', () => {
    storeSecret('cred-3', { value: 'v' })
    deleteSecret('cred-3')
    expect(readSecret('cred-3')).toBeNull()
    expect(() => deleteSecret('cred-3')).not.toThrow()
  })

  test('decrypting with a different key returns null instead of throwing', () => {
    storeSecret('cred-4', { value: 'v' })
    process.env.DASHBOARD_SECRET_KEY = 'a-completely-different-passphrase'
    expect(readSecret('cred-4')).toBeNull()
  })

  test('storeSecret throws a clear error when DASHBOARD_SECRET_KEY is unset', () => {
    delete process.env.DASHBOARD_SECRET_KEY
    expect(() => storeSecret('cred-5', { value: 'v' })).toThrow(/DASHBOARD_SECRET_KEY/)
  })
})
