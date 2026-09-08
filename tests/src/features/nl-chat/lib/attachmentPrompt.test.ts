import { describe, expect, it } from 'vitest'
import { appendAttachments, buildAttachmentBlock } from '@/features/nl-chat/lib/attachmentPrompt'

// The block is what tells the agent where the uploaded files landed — the chat
// sends paths, not contents, so this text IS the attachment feature's contract.

describe('buildAttachmentBlock', () => {
  it('is empty when nothing was attached', () => {
    expect(buildAttachmentBlock([])).toBe('')
  })

  it('lists one line per file, name → absolute path', () => {
    const block = buildAttachmentBlock([
      { name: 'a.png', path: '/root/tasks/T1/attachments/u/a.png' },
      { name: 'notes.md', path: '/root/tasks/T1/attachments/u/notes.md' },
    ])
    const lines = block.split('\n')
    expect(lines).toHaveLength(3) // heading + 2 files
    expect(lines[1]).toBe('- a.png → /root/tasks/T1/attachments/u/a.png')
    expect(lines[2]).toBe('- notes.md → /root/tasks/T1/attachments/u/notes.md')
  })
})

describe('appendAttachments', () => {
  it('returns the text untouched when there is nothing to attach', () => {
    expect(appendAttachments('xin chào', [])).toBe('xin chào')
  })

  it('separates the block from the message with a blank line', () => {
    const out = appendAttachments('xem file này', [{ name: 'a.png', path: '/p/a.png' }])
    expect(out.startsWith('xem file này\n\n')).toBe(true)
    expect(out).toContain('- a.png → /p/a.png')
  })

  it('an attachment-only send still produces a non-empty message', () => {
    // The message routes require `min(1)`, so file-only sends rely on this.
    const out = appendAttachments('', [{ name: 'a.png', path: '/p/a.png' }])
    expect(out.length).toBeGreaterThan(0)
    expect(out.startsWith('\n')).toBe(false)
  })
})
