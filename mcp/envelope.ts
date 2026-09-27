// Envelope kết quả tool cho MCP server (vai inbound).
//
// Tách khỏi `server.ts` vì `tools/*.ts` cũng cần `ok`/`fail`, mà `server.ts`
// import ngược lại các handler đó — để chung một file là vòng import. `server.ts`
// re-export `ok`/`fail`/`McpErrorCode` nên public surface không đổi.

/** Mã lỗi máy đọc được cho agent tự phục hồi (gỡ L10). */
export type McpErrorCode = 'not_found' | 'invalid_input' | 'forbidden_in_mode' | 'internal'

/**
 * D6: giữ SONG SONG `content[0].text` và `structuredContent`. Bỏ `content` là
 * breaking — mọi client (và `tests/mcp/server.test.ts`) đang `JSON.parse` nó.
 * G1: tool nào khai `outputSchema` thì THIẾU `structuredContent` là `McpError`
 * runtime chứ không phải cảnh báo, nên hai thứ phải đi cùng nhau.
 *
 * `{ structured: false }` bỏ hẳn KHOÁ `structuredContent` (không gán
 * `undefined`) cho hai tool payload lớn — `get_knowledge_bundle` và
 * `read_artifact` — vì nhân đôi payload trên stdio là 2 MiB với bundle sát trần
 * (G8). Hai tool đó cũng không khai `outputSchema`.
 *
 * Trả `any` để không bám vào union literal content-type của SDK.
 */
export function ok(payload: unknown, opts?: { structured?: boolean }): any {
  const content = [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
  if (opts?.structured === false) return { content }
  return { content, structuredContent: payload }
}

export function fail(message: unknown): any
export function fail(code: McpErrorCode, message: unknown): any
/**
 * D14: overload một-tham-số giữ NGUYÊN hình dạng cũ — test và client cũ bám vào
 * nó. Overload hai-tham-số cũng không đổi `isError` lẫn `content[0].text`, chỉ
 * gắn thêm mã máy đọc được.
 *
 * Phân nhánh theo SỐ THAM SỐ chứ không theo `b === undefined`, để
 * `fail('internal', undefined)` vẫn là ca hai-tham-số.
 *
 * ⚠️ Mã lỗi đi ở `_meta.error`, KHÔNG phải `structuredContent` — server và
 * client của SDK 1.29.0 lệch nhau ở đúng chỗ này:
 *
 * - `server/mcp.js` `validateToolOutput` có `if (result.isError) return` ⇒ phía
 *   server miễn validate nhánh lỗi.
 * - `client/index.js:508` chỉ hỏi `if (result.structuredContent)`, KHÔNG loại trừ
 *   `isError` (comment ngay trên nó nói ngược lại với code). Nên mọi client đã
 *   gọi `tools/list` — Claude Code luôn gọi — sẽ ném
 *   `McpError -32602 Structured content does not match the tool's output schema`
 *   khi tool CÓ `outputSchema` trả `fail` kèm `structuredContent`.
 *
 * Đặt ở `_meta` giải được cả hai: `_meta` nằm ở `Result` base của MCP và là
 * `.passthrough()`, không bị đối chiếu với `outputSchema` ở bất kỳ phía nào. Nó
 * cũng đồng nhất cho mọi tool — `fail()` không biết nó đang được gọi trong tool
 * có hay không có `outputSchema`, nên phương án "bỏ `structuredContent` tuỳ tool"
 * không hiện thực hoá sạch được.
 */
export function fail(...args: [unknown] | [McpErrorCode, unknown]): any {
  if (args.length < 2) {
    return { isError: true, content: [{ type: 'text', text: String(args[0]) }] }
  }
  const [code, message] = args
  const text = String(message)
  return {
    isError: true,
    content: [{ type: 'text', text }],
    _meta: { error: { code, message: text } },
  }
}
