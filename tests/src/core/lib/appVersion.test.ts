import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_VERSION } from '../../../../src/core/lib/appVersion'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

describe('APP_VERSION', () => {
  it('matches package.json version (injected via vitest define)', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
