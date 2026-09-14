/**
 * Cắt/ghép markdown theo heading cấp 2 — hàm thuần, không phụ thuộc gì.
 *
 * Ở tầng `frontend/lib` chứ không nằm trong composable của một feature: cả
 * inline edit của monitor lẫn viewer của agent-editor đều cắt section theo
 * đúng luật này, và hai bản regex lệch nhau là bug âm thầm.
 *
 * Tách khỏi `markdownLib.ts` có chủ đích: module đó kéo theo `marked` +
 * `DOMPurify` + `mermaid`, nên nhiều suite phải `vi.mock` nó. Hàm thuần nằm
 * chung ở đó sẽ biến mất theo mock, dù test chỉ muốn thay mỗi `parseMarkdown`.
 */

/** Cắt theo heading cấp 2, giữ nguyên `##` ở đầu mỗi phần. */
export function splitMarkdownSections(source: string): string[] {
  if (!source.trim()) return []
  return source.split(/^(?=##\s)/m).filter((p) => p.trim())
}

/** Ghép ngược danh sách section thành một chuỗi markdown. */
export function joinMarkdownSections(parts: string[]): string {
  return parts.filter((p) => p.trim()).join('\n\n')
}
