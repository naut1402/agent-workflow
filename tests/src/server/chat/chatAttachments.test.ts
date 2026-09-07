import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  checkAttachmentLimits,
  sanitizeAttachmentName,
  saveChatAttachments,
} from '../../../../src/features/nl-chat/business/chatAttachments'

// Files dropped into the chat composer land under the data root and the chat
// then sends their PATHS to the agent. Two things matter here: the bytes must
// survive intact, and a hostile filename must never escape the root.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x7f])

let root: string

function file(over: Partial<{ name: string; type: string; size: number; bytes: Uint8Array }> = {}) {
  const bytes = over.bytes ?? PNG
  return {
    name: over.name ?? 'shot.png',
    type: over.type ?? 'image/png',
    size: over.size ?? bytes.byteLength,
    bytes,
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-attach-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('sanitizeAttachmentName', () => {
  test('a traversal filename collapses to its basename', () => {
    expect(sanitizeAttachmentName('../../etc/passwd')).toBe('passwd')
  })

  test('no path separator survives, so the name can never point out of its folder', () => {
    // A Windows-style path is one long basename on POSIX; what matters is that
    // the separators are gone, leaving a name `resolvePathUnder` cannot escape.
    for (const raw of ['..\\..\\windows\\system32', 'a/b/c.png', '/etc/shadow']) {
      const safe = sanitizeAttachmentName(raw)
      expect(safe).not.toContain('/')
      expect(safe).not.toContain('\\')
    }
  })

  test('empty / dot-only names get a neutral fallback', () => {
    expect(sanitizeAttachmentName('')).toBe('attachment')
    expect(sanitizeAttachmentName('...')).toBe('attachment')
    expect(sanitizeAttachmentName('   ')).toBe('attachment')
  })

  test('control characters are stripped, other odd characters become _', () => {
    expect(sanitizeAttachmentName('a\u0007b.png')).toBe('ab.png')
    // \w is ASCII-only, so a run of diacritics/symbols collapses to a single _.
    expect(sanitizeAttachmentName('b\u1EA3ng gi\u00E1$.csv')).toBe('b_ng gi_.csv')
  })

  test('long names are truncated', () => {
    expect(sanitizeAttachmentName(`${'x'.repeat(400)}.png`).length).toBeLessThanOrEqual(120)
  })

  test('an ordinary name is left alone', () => {
    expect(sanitizeAttachmentName('design-v2.md')).toBe('design-v2.md')
  })
})

describe('saveChatAttachments — limits', () => {
  test('no files at all is a 400', async () => {
    const res: any = await saveChatAttachments(root, [])
    expect(res.status).toBe(400)
  })

  test('more than 5 files in one turn is a 400', async () => {
    const files = Array.from({ length: 6 }, (_, i) => file({ name: `f${i}.png` }))
    const res: any = await saveChatAttachments(root, files)
    expect(res.status).toBe(400)
    expect(res.error).toContain('too many')
  })

  test('exactly 5 files is allowed', async () => {
    const files = Array.from({ length: 5 }, (_, i) => file({ name: `f${i}.png` }))
    const res: any = await saveChatAttachments(root, files)
    expect(res.saved).toHaveLength(5)
  })

  test('over 10 MB is a 413', async () => {
    const res: any = await saveChatAttachments(root, [file({ size: 10 * 1024 * 1024 + 1 })])
    expect(res.status).toBe(413)
  })

  test('a MIME outside the allowlist is a 415', async () => {
    const res: any = await saveChatAttachments(root, [
      file({ name: 'run.exe', type: 'application/x-msdownload' }),
    ])
    expect(res.status).toBe(415)
  })

  test('an empty browser `type` falls back to the extension allowlist', async () => {
    const ok: any = await saveChatAttachments(root, [file({ name: 'notes.md', type: '' })])
    expect(ok.saved).toHaveLength(1)

    const rejected: any = await saveChatAttachments(root, [file({ name: 'notes.bin', type: '' })])
    expect(rejected.status).toBe(415)
  })

  // The de-duplication suffix is appended AFTER the name is truncated, so the
  // cap has to leave room for it or the final name overshoots.
  test('de-duplicating a very long name still respects the length cap', async () => {
    const long = `${'x'.repeat(400)}.png`
    const res: any = await saveChatAttachments(root, [file({ name: long }), file({ name: long })])
    expect(res.saved).toHaveLength(2)
    for (const f of res.saved) expect(f.name.length).toBeLessThanOrEqual(120)
    expect(res.saved[0].name).not.toBe(res.saved[1].name)
  })
})

describe('checkAttachmentLimits — metadata-only gate', () => {
  // The route calls this BEFORE reading bytes, so it must reject on size alone.
  test('rejects an oversized file from its declared size, without any bytes', () => {
    const refusal = checkAttachmentLimits([
      { name: 'huge.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 },
    ])
    expect(refusal?.status).toBe(413)
  })

  test('rejects an empty list and a list over the per-turn cap', () => {
    expect(checkAttachmentLimits([])?.status).toBe(400)
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `f${i}.png`,
      type: 'image/png',
      size: 10,
    }))
    expect(checkAttachmentLimits(many)?.status).toBe(400)
  })

  test('rejects a type outside the allowlist and accepts an allowed one', () => {
    expect(
      checkAttachmentLimits([{ name: 'run.exe', type: 'application/x-msdownload', size: 10 }])
        ?.status,
    ).toBe(415)
    expect(checkAttachmentLimits([{ name: 'shot.png', type: 'image/png', size: 10 }])).toBeNull()
  })
})

describe('saveChatAttachments — where files land', () => {
  test('without a taskId it writes under the shared chat upload area', async () => {
    const res: any = await saveChatAttachments(root, [file()])
    const saved = res.saved[0]
    expect(saved.path.startsWith(path.join(root, 'uploads', 'chat'))).toBe(true)
    expect(fs.readFileSync(saved.path)).toEqual(Buffer.from(PNG))
  })

  test('with a taskId it writes inside that task directory (the agent CLI cwd)', async () => {
    fs.mkdirSync(path.join(root, 'tasks', 'T1'), { recursive: true })
    const res: any = await saveChatAttachments(root, [file()], { taskId: 'T1' })
    expect(res.saved[0].path.startsWith(path.join(root, 'tasks', 'T1', 'attachments'))).toBe(true)
  })

  test('binary content survives byte for byte', async () => {
    const bytes = new Uint8Array(512)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256
    const res: any = await saveChatAttachments(root, [file({ bytes, size: bytes.byteLength })])
    expect(new Uint8Array(fs.readFileSync(res.saved[0].path))).toEqual(bytes)
  })

  test('an unknown task is refused rather than silently redirected', async () => {
    const res: any = await saveChatAttachments(root, [file()], { taskId: 'nope' })
    expect(res.status).toBe(400)
    expect(fs.existsSync(path.join(root, 'uploads'))).toBe(false)
  })

  test('a traversal taskId is refused', async () => {
    const res: any = await saveChatAttachments(root, [file()], { taskId: '../../etc' })
    expect(res.status).toBe(400)
  })

  test('two files with the same name in one turn do not overwrite each other', async () => {
    const a = new Uint8Array([1, 1, 1])
    const b = new Uint8Array([2, 2, 2])
    const res: any = await saveChatAttachments(root, [
      file({ name: 'shot.png', bytes: a, size: 3 }),
      file({ name: 'shot.png', bytes: b, size: 3 }),
    ])
    expect(res.saved.map((f: any) => f.name)).toEqual(['shot.png', 'shot-2.png'])
    expect(new Uint8Array(fs.readFileSync(res.saved[0].path))).toEqual(a)
    expect(new Uint8Array(fs.readFileSync(res.saved[1].path))).toEqual(b)
  })

  test('a traversal filename is written under the root, not above it', async () => {
    const res: any = await saveChatAttachments(root, [file({ name: '../../../evil.png' })])
    expect(res.saved[0].name).toBe('evil.png')
    expect(res.saved[0].path.startsWith(root + path.sep)).toBe(true)
  })

  test('the returned metadata reports the sanitized name, not the submitted one', async () => {
    const res: any = await saveChatAttachments(root, [
      file({ name: 'kế hoạch.md', type: 'text/markdown', size: 11 }),
    ])
    expect(res.saved[0]).toMatchObject({ type: 'text/markdown', size: 11 })
    expect(res.saved[0].name).not.toContain('/')
    expect(fs.existsSync(res.saved[0].path)).toBe(true)
  })
})
