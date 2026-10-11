import { describe, expect, it } from 'vitest'
import { appendDraft } from '@/features/nl-chat/lib/draftPrompt'
import { MAX_CHAT_MESSAGE_CHARS } from '@/features/nl-chat/schemas/nlChat'

/**
 * T2 — TC-P1…TC-P5 của `test-spec.md` §5.
 *
 * Ngưỡng 20 000 là bất biến của server (`NlChatMessageRequest.message`), nên
 * mọi case đo trên chuỗi ĐÃ GỘP — đúng chỗ server đo — chứ không đo riêng khối
 * draft.
 */

/** Phần draft mà `appendDraft` nối vào, tính đúng theo cách hàm dựng chuỗi. */
function blockLength(draft: Record<string, unknown>): number {
  return appendDraft('', draft).message.length
}

describe('appendDraft', () => {
  it('TC-P1: gộp câu chat + khối JSON, câu chat đứng trước', () => {
    const res = appendDraft('đổi tên', { name: 'a' })

    expect(res.attached).toBe(true)
    expect(res.message).toContain('đổi tên')
    expect(res.message).toContain('```json')
    expect(res.message).toContain('"name": "a"')
    expect(res.message.indexOf('đổi tên')).toBeLessThan(res.message.indexOf('```json'))
  })

  it('TC-P2: draft quá dài ⇒ gửi message trần, nguyên văn', () => {
    const res = appendDraft('sửa đi', { prompt: 'x'.repeat(25_000) })

    expect(res.attached).toBe(false)
    expect(res.message).toBe('sửa đi')
  })

  it('TC-P3: ngưỡng đo trên chuỗi đã gộp, không phải riêng khối draft', () => {
    const text = 'y'.repeat(19_900)
    const res = appendDraft(text, { name: 'a' })

    expect(res.attached).toBe(false)
    expect(res.message).toBe(text)
  })

  it('TC-P4: không có draft', () => {
    expect(appendDraft('xin chào', null)).toEqual({ message: 'xin chào', attached: false })
  })

  it('TC-P5a: biên dưới — gộp đúng 20 000 ký tự vẫn đính kèm', () => {
    const draft = { name: 'a' }
    // `merged = text + '\n\n' + block` ⇒ trừ đúng 2 ký tự nối.
    const text = 'y'.repeat(MAX_CHAT_MESSAGE_CHARS - blockLength(draft) - 2)
    const res = appendDraft(text, draft)

    expect(res.attached).toBe(true)
    expect(res.message).toHaveLength(MAX_CHAT_MESSAGE_CHARS)
  })

  it('TC-P5b: biên trên — 20 001 là quá', () => {
    const draft = { name: 'a' }
    const text = 'y'.repeat(MAX_CHAT_MESSAGE_CHARS - blockLength(draft) - 1)
    const res = appendDraft(text, draft)

    expect(res.attached).toBe(false)
    expect(res.message).toBe(text)
  })

  it('TC-P5c: text rỗng + có draft ⇒ không có dòng trống thừa ở đầu', () => {
    const res = appendDraft('', { name: 'a' })

    expect(res.attached).toBe(true)
    expect(res.message.startsWith('\n')).toBe(false)
    expect(res.message.startsWith('Đây là bản draft')).toBe(true)
    expect(res.message).toContain('"name": "a"')
  })
})
