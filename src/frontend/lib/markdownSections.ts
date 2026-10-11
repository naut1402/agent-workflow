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

/**
 * Cắt theo heading cấp 2, giữ nguyên `##` ở đầu mỗi phần.
 *
 * 🚫 KHÔNG nhận biết code fence — và phải giữ đúng như vậy. Chỉ số mảnh trả về
 * là hợp đồng của inline edit (`useInlineMarkdownEdit` ghi lại artifact bằng
 * chính hàm này), nên đổi luật cắt là đổi cách ghi file. Tầng mục con
 * (`splitByHeadingLevel`) mới là nơi có nhận biết fence.
 */
export function splitMarkdownSections(source: string): string[] {
  if (!source.trim()) return []
  return source.split(/^(?=##\s)/m).filter((p) => p.trim())
}

/** Ghép ngược danh sách section thành một chuỗi markdown. */
export function joinMarkdownSections(parts: string[]): string {
  return parts.filter((p) => p.trim()).join('\n\n')
}

/**
 * Một heading ATX tìm được ngoài code fence.
 *
 * `start` là offset ký tự của ĐẦU DÒNG heading trong `source` — cắt theo offset
 * chứ không ghép lại từ mảng dòng để giữ nguyên `\r\n` và mọi khoảng trắng.
 * Bất biến `source === Σ các mảnh` là điều kiện sống còn của `blockLineRanges`.
 */
interface HeadingHit {
  level: number
  start: number
}

/**
 * Quét heading ATX, BỎ QUA mọi dòng nằm trong code fence.
 *
 * Vì sao tầng này nhận biết fence còn `splitMarkdownSections` thì không:
 * `###`…`######` trùng khuôn với comment shell/python và với ví dụ markdown
 * lồng trong fence, nên bỏ qua fence ở đây sẽ cắt đôi khối code thường xuyên.
 * Tầng `##` phải giữ nguyên hành vi cũ vì nó là hợp đồng của inline edit.
 */
function scanHeadings(source: string): HeadingHit[] {
  const hits: HeadingHit[] = []
  let fenceChar: string | null = null
  let fenceLen = 0
  let offset = 0
  for (const line of source.split('\n')) {
    const lineStart = offset
    offset += line.length + 1 // +1 cho ký tự '\n' đã bị `split` ăn mất
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const char = fence[1][0]
      const len = fence[1].length
      if (fenceChar === null) {
        fenceChar = char
        fenceLen = len
      } else if (char === fenceChar && len >= fenceLen) {
        // Fence đóng phải cùng ký tự và dài ít nhất bằng fence mở (CommonMark).
        fenceChar = null
        fenceLen = 0
      }
      continue
    }
    if (fenceChar !== null) continue
    // Chỉ heading ATX và bắt buộc có khoảng trắng sau `#` — `###foo` không tính.
    const heading = /^(#{1,6})\s/.exec(line)
    if (heading) hits.push({ level: heading[1].length, start: lineStart })
  }
  return hits
}

/** Cấp heading nông nhất trong `[min..6]` xuất hiện ngoài code fence; `0` nếu không có. */
export function shallowestHeadingLevel(source: string, min = 3): number {
  let best = 0
  for (const hit of scanHeadings(source)) {
    if (hit.level < min) continue
    if (!best || hit.level < best) best = hit.level
  }
  return best
}

/**
 * Cắt theo đúng một cấp heading, giữ nguyên dòng heading ở đầu mỗi mảnh.
 *
 * Mảnh dẫn (phần trước heading đầu tiên) chỉ xuất hiện khi nó khác rỗng — kể cả
 * khi chỉ có khoảng trắng, vì bỏ đi là phá bất biến ghép-lại-nguyên-văn.
 */
export function splitByHeadingLevel(source: string, level: number): string[] {
  if (!source) return []
  const starts = scanHeadings(source)
    .filter((h) => h.level === level)
    .map((h) => h.start)
  // Không `.trim()` ở đây: nguồn chỉ có khoảng trắng vẫn phải trả về nguyên văn,
  // đồng nhất với luật `if (lead)` ngay dưới — nếu không thì `Σ parts !== source`.
  if (!starts.length) return source ? [source] : []
  const parts: string[] = []
  const lead = source.slice(0, starts[0])
  if (lead) parts.push(lead)
  for (let i = 0; i < starts.length; i++) {
    parts.push(source.slice(starts[i], starts[i + 1] ?? source.length))
  }
  return parts
}
