import { splitMarkdownSections } from './markdownSections'

/**
 * Một khối hiển thị trong `CMarkdownView`; khối `frontmatter` được bọc thành fence yaml trước khi parse.
 */
export interface MarkdownBlock {
  /** Tiêu đề `##` đã bỏ dấu; `null` khi khối không mở đầu bằng heading cấp 2. */
  heading: string | null
  kind: 'frontmatter' | 'section'
  source: string
}

/**
 * Tách frontmatter `---` … `---` ở đầu nội dung khỏi body; mở mà không đóng thì cả nội dung là body.
 */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const lines = (content || '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { frontmatter: null, body: content || '' }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return { frontmatter: null, body: content || '' }
  return {
    frontmatter: lines.slice(0, end + 1).join('\n'),
    body: lines.slice(end + 1).join('\n').trim(),
  }
}

export interface BuildMarkdownBlocksOptions {
  /**
   * Tách khối `---` ở đầu nội dung thành block metadata riêng; chỉ bật cho nguồn đọc nguyên file `.md`.
   */
  withFrontmatter?: boolean
}

/** Frontmatter thành một khối riêng (khi bật), phần còn lại cắt theo heading cấp 2. */
export function buildMarkdownBlocks(
  content: string,
  { withFrontmatter = false }: BuildMarkdownBlocksOptions = {},
): MarkdownBlock[] {
  const { frontmatter, body } = withFrontmatter
    ? splitFrontmatter(content)
    : { frontmatter: null as string | null, body: content || '' }
  const blocks: MarkdownBlock[] = []
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
