// Bộ lọc mask secret CÓ TRẠNG THÁI cho log dạng stream.
//
// Đặt ở `mcp/business/` chứ không ở `runner/business/providers/`: `maskLog` hiện
// chỉ phủ `createLocalConsoleProvider`, họ `ai-api` không đi qua đó. Để ở đây thì
// cả hai họ provider dùng chung được một bản.

import { maskSecretText } from './types.js'

export interface SecretStreamMasker {
  /** Nuốt một chunk, trả phần đã chắc chắn an toàn để phát ra ngoài. */
  push(chunk: string): string
  /** Phát nốt phần còn giữ lại. Bắt buộc gọi ở CẢ nhánh thành công lẫn nhánh lỗi. */
  flush(): string
}

/**
 * Vì sao cần trạng thái: `maskSecretText` là split/join không trạng thái, nên
 * một secret bị tiến trình con xuất làm hai chunk (`"sk-test-LEAK"` + `"CANARY"`)
 * lọt qua cả hai lần gọi — mỗi nửa không khớp chuỗi nào nên không bị thay.
 *
 * Cách chữa: giữ lại `max(len(secret)) - 1` ký tự cuối sau mỗi lần quét.
 *   - Mọi lần xuất hiện nằm TRỌN trong `buf` đã bị thay trước khi cắt.
 *   - Lần xuất hiện vắt qua cuối `buf` chỉ có thể bắt đầu trong `max(len) - 1`
 *     ký tự cuối ⇒ nằm trọn trong `pending`, không ký tự nào của nó được phát.
 *
 * ⚠️ Đánh đổi thật, không phải refactor thuần: log stream TRỄ lại tối đa
 * `max(len) - 1` ký tự cho tới `flush()`. Không flush ở nhánh lỗi là nuốt mất
 * đuôi log — đúng đoạn người dùng cần để biết job hỏng vì sao.
 */
export function createSecretStreamMasker(secrets: readonly string[]): SecretStreamMasker {
  const list = [...new Set(secrets)].filter(Boolean)
  // 📌 Hai điều kiện tách hẳn nhau. `keep === 0` có thể nghĩa là "không có
  // secret" HOẶC "secret dài nhất đúng 1 ký tự" — gộp chúng thì ca thứ hai trả
  // chunk CHƯA MASK. Hôm nay bất khả (mọi caller lọc qua `isMaskableSecret`,
  // ≥ 8 ký tự) nhưng đó là một cửa sập: bỏ bộ lọc ở caller là mất mask mà
  // 🚫 không test nào đỏ.
  const hasSecret = list.length > 0
  const keep = hasSecret ? Math.max(...list.map((s) => s.length)) - 1 : 0
  let pending = ''

  return {
    push(chunk) {
      // Không secret nào ⇒ đường cũ y nguyên: không buffer, không trễ một ký tự.
      if (!hasSecret) return chunk
      const masked = maskSecretText(pending + chunk, list)
      const cut = Math.max(0, masked.length - keep)
      pending = masked.slice(cut)
      return masked.slice(0, cut)
    },
    flush() {
      const out = maskSecretText(pending, list)
      pending = ''
      return out
    },
  }
}
