import crypto from 'node:crypto'
import { joinPath, mkdirSync, readTextFileSync, writeTextFileAtomicSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'

/**
 * Encrypted-at-rest store for real secret material (pasted API keys, OAuth
 * access/refresh tokens) — separate from `credentials.json`, which only ever
 * holds a `secretRef` pointer (never the secret itself), matching the
 * existing `env:`/`file:`/`cli-session` design (credentials.ts).
 *
 * Key comes from `DASHBOARD_SECRET_KEY`, set once by whoever deploys the
 * dashboard (infra-level secret, distinct from per-credential `env:VAR_NAME`
 * refs that an end user could never set themselves through the web UI).
 */

const ALGO = 'aes-256-gcm'

interface VaultEntry {
  iv: string
  authTag: string
  ciphertext: string
  updatedAt: string
}

interface VaultFile {
  version: 1
  entries: Record<string, VaultEntry>
}

function vaultFile(): string {
  return joinPath(registryHome(), 'secret-vault.json')
}

/** Accepts a 64-hex-char key as-is, or hashes any other string into 32 bytes — lets an operator set a plain passphrase instead of generating hex by hand. */
function masterKey(): Buffer {
  const raw = process.env.DASHBOARD_SECRET_KEY
  if (!raw) throw new Error('DASHBOARD_SECRET_KEY is not set — required to store or read vault secrets')
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  return crypto.createHash('sha256').update(raw).digest()
}

export function hasVaultKey(): boolean {
  return Boolean(process.env.DASHBOARD_SECRET_KEY)
}

function loadVault(): VaultFile {
  try {
    const raw = readTextFileSync(vaultFile())
    const data = JSON.parse(raw)
    if (!data || typeof data.entries !== 'object' || !data.entries) return { version: 1, entries: {} }
    return { version: 1, entries: data.entries }
  } catch {
    return { version: 1, entries: {} }
  }
}

function saveVault(vault: VaultFile): void {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  writeTextFileAtomicSync(vaultFile(), JSON.stringify(vault, null, 2))
}

/** Encrypts `payload` and stores it under `id`, overwriting any existing entry. */
export function storeSecret(id: string, payload: Record<string, unknown>): void {
  const key = masterKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const vault = loadVault()
  vault.entries[id] = {
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    updatedAt: new Date().toISOString(),
  }
  saveVault(vault)
}

/** Decrypts and returns the entry stored under `id`, or `null` if missing/corrupt/undecryptable — never throws. */
export function readSecret<T = Record<string, unknown>>(id: string): T | null {
  const entry = loadVault().entries[id]
  if (!entry) return null
  try {
    const key = masterKey()
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(entry.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(entry.authTag, 'base64'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, 'base64')), decipher.final()])
    return JSON.parse(plaintext.toString('utf8')) as T
  } catch {
    return null
  }
}

export function deleteSecret(id: string): void {
  const vault = loadVault()
  if (!(id in vault.entries)) return
  delete vault.entries[id]
  saveVault(vault)
}
