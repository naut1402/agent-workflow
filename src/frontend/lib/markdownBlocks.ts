import {
  shallowestHeadingLevel,
  splitByHeadingLevel,
  splitMarkdownSections,
} from './markdownSections'

/**
 * Một nút trong cây mục lục của viewer markdown dùng chung.
 *
 * Cây dựng từ chính NGUỒN markdown chứ không phải từ HTML đã sanitise: mỗi mảnh
 * vẫn đi qua `parseMarkdown` nguyên vẹn, nên không ai phải thao tác lên chuỗi đã
 * qua DOMPurify.
 *
 * Bất biến bắt buộc: `source === intro + children.map((c) => c.source).join('')`.
 * Nhờ nó, `source` của khối cấp `##` vẫn là chuỗi con nguyên văn, đúng thứ tự
 * của nội dung gốc — điều kiện sống còn của `blockLineRanges` và inline edit.
 */
export interface MarkdownNode {
  /** Dòng heading đã bỏ dấu `#`; `null` khi node không mở đầu bằng heading. */
  heading: string | null
  /** Cấp heading 2..6; `0` khi node không có heading (frontmatter / phần mở đầu). */
  level: number
  /** Nguyên văn mảnh markdown của node — GỒM dòng heading của chính nó và toàn bộ con. */
  source: string
  /**
   * Thân của riêng node: từ dòng heading tới ngay trước heading con đầu tiên.
   *
   * Node không có con ⇒ `intro === source` ⇒ `parseMarkdown(intro)` ra đúng HTML
   * như trước khi có cây. Đây là lý do tài liệu chỉ có `##` không hề hồi quy.
   */
  intro: string
  children: MarkdownNode[]
}

/**
 * Một khối hiển thị trong viewer markdown dùng chung (`CMarkdownView`).
 *
 * `frontmatter` tách riêng khỏi `section` vì nó không phải markdown: đẩy thẳng
 * `--- … ---` vào marked thì ra hai thẻ `<hr>`, nên viewer bọc nó thành fence
 * yaml trước khi parse.
 */
export interface MarkdownBlock extends MarkdownNode {
  kind: 'frontmatter' | 'section'
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

export interface BuildMarkdownBlocksOptions {
  /**
   * Tách khối `---` ở đầu nội dung thành block metadata riêng.
   *
   * Mặc định `false`: knowledge nạp qua `driver.read()` vốn đã bóc front-matter
   * sẵn, nên một entry mở đầu bằng `---` là nội dung thật của người dùng chứ
   * không phải meta. Agent editor đọc nguyên file `.md` nên bật `true`.
   */
  withFrontmatter?: boolean
}

/**
 * Dựng cây con cho một thân node, bắt đầu từ cấp heading nông nhất còn lại.
 *
 * Dùng `shallowestHeadingLevel` chứ không cố định `minLevel`: tài liệu nhảy cấp
 * (`##` → `####`) vẫn ra một tầng mục con thay vì mất sạch.
 */
function buildChildren(body: string, minLevel: number): { intro: string; children: MarkdownNode[] } {
  if (minLevel > 6) return { intro: body, children: [] }
  const level = shallowestHeadingLevel(body, minLevel)
  if (!level) return { intro: body, children: [] } // hết heading con ⇒ cả thân là intro
  const parts = splitByHeadingLevel(body, level)
  // Mảnh dẫn (nếu có) không mở đầu bằng heading ⇒ nó là intro của chính node cha.
  const intro = parts.length && !isHeadingAt(parts[0], level) ? (parts.shift() ?? '') : ''
  const children = parts.map<MarkdownNode>((source) => {
    const firstLine = source.split('\n')[0] ?? ''
    const rest = source.slice(firstLine.length) // giữ nguyên ký tự xuống dòng
    const sub = buildChildren(rest, level + 1)
    return {
      heading: firstLine.replace(/^#{1,6}\s+/, '').trim(),
      level,
      source,
      intro: firstLine + sub.intro,
      children: sub.children,
    }
  })
  return { intro, children }
}

/** Mảnh có mở đầu bằng heading ATX đúng cấp `level` không. */
function isHeadingAt(part: string, level: number): boolean {
  return new RegExp(`^#{${level}}\\s`).test(part)
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
  // Frontmatter là YAML bọc fence, không phải markdown ⇒ không cắt mục con.
  if (frontmatter) {
    blocks.push({
      heading: null,
      kind: 'frontmatter',
      level: 0,
      source: frontmatter,
      intro: frontmatter,
      children: [],
    })
  }
  for (const source of splitMarkdownSections(body)) {
    const firstLine = source.split('\n')[0] ?? ''
    const isH2 = /^##\s/.test(firstLine)
    // Khối mở đầu bằng `##` thì thân là phần sau dòng heading; khối dẫn (chưa có
    // heading nào) thì cả nguồn là thân và vẫn được cắt mục con như thường.
    const nodeBody = isH2 ? source.slice(firstLine.length) : source
    const sub = buildChildren(nodeBody, 3)
    blocks.push({
      heading: isH2 ? firstLine.replace(/^##\s+/, '').trim() : null,
      kind: 'section',
      level: isH2 ? 2 : 0,
      source,
      intro: isH2 ? firstLine + sub.intro : sub.intro,
      children: sub.children,
    })
  }
  return blocks
}

/**
 * Mọi path mục con trong danh sách khối, dạng `'<blockIndex>/<i>/<j>…'`.
 *
 * Path là chuỗi chỉ số, cùng triết lý với chỉ số khối đang dùng cho inline edit.
 * Node gốc (khối) KHÔNG có path — nó đã có chỉ số riêng trong `openBlocks`.
 */
export function collectNodePaths(blocks: MarkdownBlock[]): string[] {
  const paths: string[] = []
  const walk = (nodes: MarkdownNode[], prefix: string) => {
    nodes.forEach((node, i) => {
      const path = `${prefix}/${i}`
      paths.push(path)
      walk(node.children, path)
    })
  }
  blocks.forEach((block, i) => walk(block.children, String(i)))
  return paths
}

/** Một node đã kèm sẵn HTML — dựng một lần ở computed, không dựng trong render function. */
export interface RenderedNode extends MarkdownNode {
  html: string
  children: RenderedNode[]
}

/**
 * Dựng sẵn HTML cho cả cây mục con.
 *
 * ⚠️ Phải gọi trong computed của viewer, KHÔNG gọi trong render function của
 * component. Mọi `<details>` mục con đều đọc `openNodes` để biết mình đang mở
 * hay đóng, nên nếu `parseMarkdown` nằm trong render function thì gập/mở MỘT
 * mục con sẽ invalidate render effect của mọi mục con và parse lại gần như cả
 * tài liệu — đúng đường nóng của tính năng "đọc tài liệu dài". Nằm trong
 * computed thì chỉ parse lại khi `content` đổi, đồng nhất với tầng khối.
 *
 * `render` nhận từ ngoài chứ không `import parseMarkdown` tại chỗ: `markdownLib`
 * kéo theo marked + DOMPurify + mermaid nên nhiều suite phải `vi.mock` nó.
 */
export function renderNodes(
  nodes: MarkdownNode[],
  render: (markdown: string) => string,
): RenderedNode[] {
  return nodes.map((node) => ({
    ...node,
    html: render(node.intro),
    children: renderNodes(node.children, render),
  }))
}

/** Bọc frontmatter thành fence yaml để `parseMarkdown` ra khối code đọc được. */
export function fenceYaml(source: string): string {
  return '```yaml\n' + source + '\n```'
}
