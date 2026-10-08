import { describe, expect, test } from 'bun:test'
import { createSecretStreamMasker } from '../../../../../src/features/mcp/business/secretStream.js'
import { MCP_MASK, maskSecretText } from '../../../../../src/features/mcp/business/types.js'

/**
 * TC-SEC-41…TC-SEC-48 — bộ lọc mask CÓ TRẠNG THÁI cho log dạng stream (#385, PR 1).
 *
 * Bề mặt: `createSecretStreamMasker(secrets)` → `{ push(chunk), flush() }`.
 *
 * Ca đỏ ở đây nghĩa là một mảnh secret đã đi ra ngoài, nên mọi ca âm bản quét
 * **toàn bộ** output nối lại chứ 🚫 không chỉ nhìn chunk cuối (`test-spec.md` §2.3).
 */

const CANARY = 'sk-test-LEAKCANARY-0123456789'

/** Nối mọi thứ bộ lọc phát ra — đây mới là thứ tới UI/log, không phải từng chunk. */
function drain(secrets: readonly string[], chunks: readonly string[]): string {
  const masker = createSecretStreamMasker(secrets)
  return chunks.map((c) => masker.push(c)).join('') + masker.flush()
}

describe('createSecretStreamMasker — secret vắt qua biên chunk', () => {
  // TC-SEC-41 ⭐
  test('TC-SEC-41: secret cắt làm 2 chunk ⇒ 🚫 không mảnh nào lọt, đúng 1 sentinel', () => {
    const out = drain([CANARY], ['…head sk-test-LEAK', 'CANARY-0123456789 tail…'])

    expect(out).not.toContain(CANARY)
    expect(out).not.toContain('sk-test-LEAK')
    expect(out).not.toContain('CANARY-0123')
    expect(out.split(MCP_MASK)).toHaveLength(2) // đúng 1 sentinel
    expect(out).toBe(`…head ${MCP_MASK} tail…`)
  })

  // TC-SEC-42 — chunk giữa nằm TRỌN trong secret.
  test('TC-SEC-42: secret cắt làm 3 chunk ⇒ 🚫 không mảnh nào lọt', () => {
    const out = drain([CANARY], ['a sk-test-', 'LEAKCANARY-0123', '456789 b'])

    expect(out).not.toContain(CANARY)
    expect(out).not.toContain('LEAKCANARY')
    expect(out).toBe(`a ${MCP_MASK} b`)
  })

  // TC-SEC-43 ⭐ — secret ở CUỐI luồng, chỉ `flush()` mới phát ra được.
  test('TC-SEC-43: secret ở cuối luồng ⇒ flush() phát mask, 🚫 không mất ký tự nào', () => {
    const masker = createSecretStreamMasker([CANARY])
    const pushed = masker.push(`tail ${CANARY}`)
    const flushed = masker.flush()

    expect(flushed).not.toBe('')
    expect(pushed + flushed).toBe(`tail ${MCP_MASK}`)
    expect(pushed + flushed).not.toContain(CANARY)
  })

  test('TC-SEC-43b: ký tự ĐỨNG SAU secret ở cuối luồng 🚫 không bị nuốt', () => {
    const masker = createSecretStreamMasker([CANARY])
    const out = masker.push(`x ${CANARY} duoi-cung`) + masker.flush()
    expect(out).toBe(`x ${MCP_MASK} duoi-cung`)
  })

  /**
   * TC-SEC-44 ⭐ — ca khoá SEC-11 *"job không bật MCP ⇒ UX stream 🚫 không đổi"*.
   * `push` phải trả **đúng chunk**, cùng độ dài, NGAY LẬP TỨC (0 ký tự bị giữ lại).
   */
  test('TC-SEC-44: secrets rỗng ⇒ push trả nguyên chunk tức thì, flush trả rỗng', () => {
    const masker = createSecretStreamMasker([])
    const chunks = ['dong 1\n', 'dong 2 sk-khong-phai-secret\n', '']

    for (const chunk of chunks) {
      const out = masker.push(chunk)
      expect(out).toBe(chunk)
      expect(out).toHaveLength(chunk.length)
    }
    expect(masker.flush()).toBe('')
  })

  // TC-SEC-45
  test('TC-SEC-45: nhiều secret độ dài 3/12/41 ⇒ mask hết, giữ lại ≤ max(len)-1', () => {
    const secrets = ['abc', 'tok-0123-456', `${CANARY}-${'x'.repeat(11)}`]
    expect(secrets.map((s) => s.length)).toEqual([3, 12, 41])
    const maxLen = Math.max(...secrets.map((s) => s.length))

    const text = `p ${secrets[0]} q ${secrets[1]} r ${secrets[2]} s`
    const chunks = text.match(/.{1,7}/gs) ?? []

    const masker = createSecretStreamMasker(secrets)
    let consumed = ''
    let emitted = ''
    for (const chunk of chunks) {
      consumed += chunk
      emitted += masker.push(chunk)
      // Đo trên bản ĐÃ MASK: tổng mask = phần đã phát + phần còn giữ lại, nên
      // hiệu hai vế chính là độ dài buffer. So trên bản thô thì phép trừ còn
      // nuốt cả phần text ngắn đi vì mask, 🚫 không đo đúng thứ cần đo.
      const retained = maskSecretText(consumed, secrets).length - emitted.length
      expect(retained).toBeGreaterThanOrEqual(0)
      expect(retained).toBeLessThanOrEqual(maxLen - 1)
    }
    const whole = emitted + masker.flush()

    for (const secret of secrets) expect(whole).not.toContain(secret)
    expect(whole).toBe(`p ${MCP_MASK} q ${MCP_MASK} r ${MCP_MASK} s`)
  })

  /**
   * TC-SEC-46 — bất biến: cách chia chunk 🚫 không ảnh hưởng kết quả.
   * Chia ngẫu nhiên ≥ 20 lượt, mỗi lượt phải bằng `maskSecretText` không-trạng-thái.
   */
  test('TC-SEC-46: concat(push…) + flush() === maskSecretText, mọi cách chia chunk', () => {
    const secrets = [CANARY, 'ghp_LEAKCANARY0123456789', 'abcdefgh']
    const text = [
      `mo dau ${CANARY} giua`,
      `lap lai ${CANARY} lan hai`,
      `inline ghp_LEAKCANARY0123456789 va abcdefgh`,
      `duoi cung ${CANARY}`,
    ].join('\n')
    const expected = maskSecretText(text, secrets)

    // Seed cố định ⇒ ca này tái lập được, 🚫 không flaky.
    let seed = 20_251_008
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

    for (let round = 0; round < 20; round++) {
      const chunks: string[] = []
      let i = 0
      while (i < text.length) {
        const size = 1 + Math.floor(rand() * 9)
        chunks.push(text.slice(i, i + size))
        i += size
      }
      expect(drain(secrets, chunks), `lượt chia #${round}`).toBe(expected)
    }
  })

  // TC-SEC-47
  test('TC-SEC-47: secret xuất hiện 2 lần, lần 2 vắt chunk ⇒ cả hai đều bị mask', () => {
    const out = drain([CANARY], [`mot ${CANARY} hai sk-test-`, 'LEAKCANARY-0123456789 ba'])

    expect(out).not.toContain(CANARY)
    expect(out).toBe(`mot ${MCP_MASK} hai ${MCP_MASK} ba`)
    expect(out.split(MCP_MASK)).toHaveLength(3)
  })

  // TC-SEC-48
  test('TC-SEC-48: push("") và flush() hai lần ⇒ 🚫 không ném, flush idempotent', () => {
    const masker = createSecretStreamMasker([CANARY])

    expect(() => masker.push('')).not.toThrow()
    expect(masker.push('')).toBe('')

    masker.push(`co ${CANARY}`)
    const first = masker.flush()
    expect(() => masker.flush()).not.toThrow()
    expect(masker.flush()).toBe('')
    expect(first).not.toContain(CANARY)

    // Bộ lọc rỗng cũng phải idempotent.
    const empty = createSecretStreamMasker([])
    expect(empty.flush()).toBe('')
    expect(empty.flush()).toBe('')
  })

  test('TC-SEC-48b: secret dài đúng 1 ký tự ⇒ vẫn mask (keep === 0 🚫 không gộp hai nghĩa)', () => {
    // `hasSecret` tách khỏi `keep` chính là để ca này 🚫 rơi về đường "không secret".
    expect(drain(['X'], ['a', 'X', 'b'])).toBe(`a${MCP_MASK}b`)
  })
})
