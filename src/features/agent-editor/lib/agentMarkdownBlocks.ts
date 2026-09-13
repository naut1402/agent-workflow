import { splitMarkdownSections } from '../../../frontend/lib/markdownSections'

/**
 * Một khối hiển thị trong viewer agent.
 *
 * `frontmatter` tách riêng khỏi `section` vì nó không phải markdown: đẩy thẳng
 * `--- … ---` vào marked thì ra hai thẻ `<hr>`, nên viewer bọc nó thành fence
 * yaml trước khi parse.
 */
export interface AgentBlock {
  /** Tiêu đề `##` đã bỏ dấu; `null` khi khối không mở đầu bằng heading cấp 2. */
  heading: string | null
  kind: 'frontmatter' | 'section'
  source: string
}

/**
 * Tách frontmatter `---` … `---` ở đầu file khỏi phần body.
 *
 * Không dùng `business/agentMarkdown.js` — module đó kéo theo `yamlLib` chỉ
 * chạy được ở Node, còn hàm này phải chạy trong browser.
 */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const lines = (content || '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { frontmatter: null, body: content || '' }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  // Mở mà không đóng → coi cả file là body, thay vì nuốt tất cả vào một khối code.
  if (end < 0) return { frontmatter: null, body: content || '' }
  return {
    frontmatter: lines.slice(0, end + 1).join('\n'),
    body: lines.slice(end + 1).join('\n').trim(),
  }
}

/** Frontmatter thành một khối riêng, phần còn lại cắt theo heading cấp 2. */
export function buildAgentBlocks(content: string): AgentBlock[] {
  const { frontmatter, body } = splitFrontmatter(content)
  const blocks: AgentBlock[] = []
  if (frontmatter) blocks.push({ heading: null, kind: 'frontmatter', source: frontmatter })
  for (const source of splitMarkdownSections(body)) {
    const firstLine = source.split('\n')[0] ?? ''
    const isH2 = /^##\s/.test(firstLine)
    blocks.push({
      heading: isH2 ? firstLine.replace(/^##\s+/, '').trim() : null,
      kind: 'section',
      source,
    })
  }
  return blocks
}

/** Bọc frontmatter thành fence yaml để `parseMarkdown` ra khối code đọc được. */
export function fenceYaml(source: string): string {
  return '```yaml\n' + source + '\n```'
}
