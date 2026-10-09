/** Cắt theo heading cấp 2, giữ nguyên `##` ở đầu mỗi phần. */
export function splitMarkdownSections(source: string): string[] {
  if (!source.trim()) return []
  return source.split(/^(?=##\s)/m).filter((p) => p.trim())
}

/** Ghép ngược danh sách section thành một chuỗi markdown. */
export function joinMarkdownSections(parts: string[]): string {
  return parts.filter((p) => p.trim()).join('\n\n')
}
