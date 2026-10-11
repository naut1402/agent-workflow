import { describe, expect, it, vi } from 'vitest'
import {
  buildMarkdownBlocks,
  collectNodePaths,
  fenceYaml,
  renderNodes,
  splitFrontmatter,
} from '@/frontend/lib/markdownBlocks'
import type { MarkdownNode } from '@/frontend/lib/markdownBlocks'
import { splitMarkdownSections } from '@/frontend/lib/markdownSections'

/**
 * Chuyển lên tầng chung từ `features/agent-editor/lib/agentMarkdownBlocks` khi
 * viewer markdown thành `CMarkdownView` (agent editor + knowledge).
 *
 * Khác biệt duy nhất về hành vi: tách frontmatter giờ là **opt-in**
 * (`withFrontmatter`) — xem describe cuối file.
 */

const WITH_FM = `---
name: reviewer
model: claude-opus-5
---

## Role

Review code.

## Skills

- lint
`

describe('splitFrontmatter', () => {
  it('tách khối --- … --- ở đầu file khỏi body', () => {
    const { frontmatter, body } = splitFrontmatter(WITH_FM)
    expect(frontmatter).toBe('---\nname: reviewer\nmodel: claude-opus-5\n---')
    expect(body.startsWith('## Role')).toBe(true)
    expect(body).not.toContain('name: reviewer')
  })

  it('không có frontmatter thì trả nguyên văn làm body', () => {
    const src = '## Role\n\nbody'
    expect(splitFrontmatter(src)).toEqual({ frontmatter: null, body: src })
  })

  // E9: mở mà không đóng — không được nuốt cả file vào một khối code.
  it('mở --- mà không đóng thì coi cả file là body', () => {
    const src = '---\nname: broken\n\n## Role\n\nbody'
    expect(splitFrontmatter(src)).toEqual({ frontmatter: null, body: src })
  })

  it('chuỗi rỗng không ném lỗi', () => {
    expect(splitFrontmatter('')).toEqual({ frontmatter: null, body: '' })
  })
})

describe('buildMarkdownBlocks — withFrontmatter: true', () => {
  const build = (src: string) => buildMarkdownBlocks(src, { withFrontmatter: true })

  it('frontmatter thành block riêng, phần còn lại cắt theo ##', () => {
    expect(build(WITH_FM).map((b) => [b.kind, b.heading])).toEqual([
      ['frontmatter', null],
      ['section', 'Role'],
      ['section', 'Skills'],
    ])
  })

  // TC-30: nội dung phẳng, không heading ## nào — không được nuốt mất.
  it('không có heading ## thì vẫn trả đủ nội dung trong một block không tiêu đề', () => {
    const blocks = build('Chỉ là văn bản phẳng.\n\n# H1 thôi')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].heading).toBeNull()
    expect(blocks[0].kind).toBe('section')
    expect(blocks[0].source).toContain('Chỉ là văn bản phẳng.')
    expect(blocks[0].source).toContain('# H1 thôi')
  })

  // E8: không frontmatter ⇒ không có block Metadata.
  it('không có frontmatter thì không sinh block kind=frontmatter', () => {
    const blocks = build('## A\n\na\n\n## B\n\nb')
    expect(blocks.every((b) => b.kind === 'section')).toBe(true)
    expect(blocks.map((b) => b.heading)).toEqual(['A', 'B'])
  })

  // TC-31 + TC-29: ghép lại các block phải bằng nguồn — không mất chữ.
  it('giữ nguyên thứ tự và không mất nội dung khi ghép ngược lại', () => {
    const rejoined = build(WITH_FM).map((b) => b.source.trim()).join('\n\n')
    for (const line of ['name: reviewer', '## Role', 'Review code.', '## Skills', '- lint']) {
      expect(rejoined).toContain(line)
    }
  })

  // TC-31: luật cắt không phân biệt code fence — parity với viewer sẵn có của repo.
  it('cắt section không phân biệt code fence, nhưng không mất chữ', () => {
    const blocks = build('## A\n\n```md\n## trong fence\n```\n')
    expect(blocks).toHaveLength(2)
    expect(blocks.map((b) => b.source).join('')).toContain('## trong fence')
  })

  it('nội dung rỗng trả về mảng rỗng', () => {
    expect(build('')).toEqual([])
  })
})

/**
 * Mặc định của tầng chung. Knowledge nạp entry qua `driver.read()` vốn đã bóc
 * front-matter sẵn, nên một entry **mở đầu bằng `---`** là nội dung thật của
 * người dùng — tách nó ra là nuốt mất phần đầu tài liệu.
 */
describe('buildMarkdownBlocks — withFrontmatter mặc định false', () => {
  it('KHÔNG tách khối --- đầu nội dung thành block Metadata', () => {
    const blocks = buildMarkdownBlocks(WITH_FM)
    expect(blocks.every((b) => b.kind === 'section')).toBe(true)
    expect(blocks[0].source).toContain('name: reviewer')
  })

  it('gọi không tham số và gọi với `{}` cho cùng kết quả', () => {
    expect(buildMarkdownBlocks(WITH_FM)).toEqual(buildMarkdownBlocks(WITH_FM, {}))
  })

  it('nội dung thường vẫn cắt theo ## như cũ', () => {
    expect(buildMarkdownBlocks('## A\n\na\n\n## B\n\nb').map((b) => b.heading)).toEqual(['A', 'B'])
  })
})

describe('fenceYaml', () => {
  it('bọc frontmatter thành fence yaml để marked không dựng thành <hr>', () => {
    expect(fenceYaml('---\na: 1\n---')).toBe('```yaml\n---\na: 1\n---\n```')
  })
})

/**
 * [Tfe960c47] Cây mục con (`###`…`######`) — nhóm §3 của `test-spec.md`.
 *
 * Bất biến trụ cột: `source === intro + Σ children.source`. Mọi ca dưới đây
 * quay quanh nó, vì `blockLineRanges` + inline edit của `ArtifactPanel` đọc
 * `block.source` như một chuỗi con NGUYÊN VĂN, đúng thứ tự, của tài liệu.
 */
const DOC_A = `---
title: x
---

Mở đầu trước heading đầu tiên.

## Block A

Dẫn nhập của A.

### A.1

Nội dung A.1

#### A.1.1

Nội dung sâu hơn

### A.2

Nội dung A.2

## Block B

~~~text
### Không phải heading
~~~

Kết B.
`

/** `source === intro + Σ children.source` ở MỌI node của cây. */
function assertNoTextLost(node: MarkdownNode) {
  expect(node.intro + node.children.map((c) => c.source).join('')).toBe(node.source)
  node.children.forEach(assertNoTextLost)
}

describe('buildMarkdownBlocks — cây mục con (TC-A01…A03, TC-A16, TC-A17)', () => {
  const blocks = () => buildMarkdownBlocks(DOC_A, { withFrontmatter: true })

  it('TC-A01: dựng đúng cây nhiều cấp, đúng thứ tự tài liệu', () => {
    const a = blocks().find((b) => b.heading === 'Block A')!
    expect(a.children.map((c) => [c.heading, c.level])).toEqual([
      ['A.1', 3],
      ['A.2', 3],
    ])
    expect(a.children[0].children.map((c) => [c.heading, c.level])).toEqual([['A.1.1', 4]])
    expect(a.children[1].children).toEqual([])
  })

  it('TC-A02: ghép intro + nguồn mọi mục con ra đúng nguyên văn nguồn block', () => {
    blocks().forEach(assertNoTextLost)
    // Và ghép mọi block lại phải ra đúng phần body của tài liệu.
    const body = DOC_A.slice(DOC_A.indexOf('Mở đầu')).trim()
    expect(blocks().filter((b) => b.kind === 'section').map((b) => b.source).join('')).toBe(body)
  })

  it('TC-A03 + TC-A04: block chỉ chứa fence ⇒ 0 mục con, fence giữ nguyên', () => {
    const b = blocks().find((x) => x.heading === 'Block B')!
    expect(b.children).toEqual([])
    expect(b.source).toContain('### Không phải heading')
    expect(b.intro).toBe(b.source)
  })

  it('TC-A16: đoạn trước heading `##` đầu tiên không biến mất', () => {
    const lead = blocks().find((b) => b.kind === 'section' && b.heading === null)!
    expect(lead.source).toContain('Mở đầu trước heading đầu tiên.')
  })

  it('TC-A17: frontmatter là block riêng, 0 mục con, `##` bên trong không cắt', () => {
    const fm = buildMarkdownBlocks('---\ntitle: x\n## giả\n---\n\n## Thật\n\nbody', {
      withFrontmatter: true,
    })
    expect(fm[0].kind).toBe('frontmatter')
    expect(fm[0].children).toEqual([])
    expect(fm[0].source).toContain('## giả')
    expect(fm.slice(1).map((b) => b.heading)).toEqual(['Thật'])
  })
})

describe('buildMarkdownBlocks — hình dạng cây ở ca biên (TC-A12…A23)', () => {
  it('TC-A12: nhảy cấp `##` → `####` không sinh mục rỗng, vẫn gập được', () => {
    const [x] = buildMarkdownBlocks('## X\n\n#### Y\n\ny')
    // Độ sâu lồng là lựa chọn hiện thực — chỉ chốt bất biến, không chốt số tầng.
    expect(x.children.map((c) => c.heading)).toEqual(['Y'])
    assertNoTextLost(x)
  })

  it('TC-A13: tụt rồi lên lại cấp — Q là anh em của P, không phải con của P1', () => {
    const [b] = buildMarkdownBlocks('## B\n\n### P\n\np\n\n#### P1\n\np1\n\n### Q\n\nq')
    expect(b.children.map((c) => c.heading)).toEqual(['P', 'Q'])
    expect(b.children[0].children.map((c) => c.heading)).toEqual(['P1'])
    expect(b.children[1].children).toEqual([])
    assertNoTextLost(b)
  })

  it('TC-A14: tài liệu không có heading nào ⇒ 1 block, 0 mục con, nguyên văn', () => {
    const blocks = buildMarkdownBlocks('chỉ là một đoạn văn')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].children).toEqual([])
    expect(blocks[0].source).toBe('chỉ là một đoạn văn')
  })

  it('TC-A15: rỗng / chỉ khoảng trắng ⇒ không ném lỗi, kết quả ổn định', () => {
    for (const src of ['', '\n\n  \n']) {
      expect(buildMarkdownBlocks(src)).toEqual([])
      expect(buildMarkdownBlocks(src)).toEqual(buildMarkdownBlocks(src))
    }
  })

  it('TC-A18: chỉ có `###` mà không có `##` ⇒ vẫn gập được, không mất chữ', () => {
    const [b] = buildMarkdownBlocks('# Title\n\n### A\n\na\n\n### B\n\nb')
    expect(b.children.map((c) => c.heading)).toEqual(['A', 'B'])
    expect(b.intro).toContain('# Title')
    assertNoTextLost(b)
  })

  /**
   * TC-A19: `Title` + `---` là setext h2 với marked, nhưng `scanHeadings` chỉ
   * nhận ATX. 📌 Giữ hành vi hiện hành (chênh lệch có sẵn ở tầng `##`, không
   * phát sinh từ task này) — chỉ chốt "không mất chữ, không ném lỗi".
   */
  it('TC-A19: setext heading không phải ranh giới gập, nhưng không mất chữ', () => {
    const blocks = buildMarkdownBlocks('Title\n---\n\nbody')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].children).toEqual([])
    expect(blocks[0].source).toBe('Title\n---\n\nbody')
  })

  it('TC-A22: CRLF cắt ra đúng số mục con như LF', () => {
    const lf = buildMarkdownBlocks(DOC_A, { withFrontmatter: true })
    const crlf = buildMarkdownBlocks(DOC_A.replace(/\n/g, '\r\n'), { withFrontmatter: true })
    expect(collectNodePaths(crlf)).toEqual(collectNodePaths(lf))
    crlf.forEach(assertNoTextLost)
  })

  it('TC-A23: ~500 heading `###` — không ném lỗi, không treo, đủ 500 mục con', () => {
    const big = '## Big\n\n' + Array.from({ length: 500 }, (_, i) => `### H${i}\n\nnội dung ${i}\n`).join('\n')
    const [b] = buildMarkdownBlocks(big)
    expect(b.children).toHaveLength(500)
    assertNoTextLost(b)
  })
})

describe('collectNodePaths — định danh mục con (TC-A20, TC-A21)', () => {
  it('TC-A20: gọi hai lần trên cùng chuỗi cho danh sách path giống hệt', () => {
    const once = collectNodePaths(buildMarkdownBlocks(DOC_A, { withFrontmatter: true }))
    const twice = collectNodePaths(buildMarkdownBlocks(DOC_A, { withFrontmatter: true }))
    expect(once).toEqual(twice)
    expect(once).toEqual(['2/0', '2/0/0', '2/1'])
  })

  it('TC-A21: hai mục con trùng tiêu đề vẫn phân biệt được bằng path', () => {
    const paths = collectNodePaths(
      buildMarkdownBlocks('## A\n\n### Ghi chú\n\n1\n\n### Ghi chú\n\n2'),
    )
    expect(paths).toEqual(['0/0', '0/1'])
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('tài liệu không có mục con ⇒ danh sách path rỗng', () => {
    expect(collectNodePaths(buildMarkdownBlocks('## A\n\na\n\n## B\n\nb'))).toEqual([])
  })
})

/**
 * [must] của `review.md` §2: `parseMarkdown` phải chạy ở computed, không ở render
 * function. `renderNodes` là nơi hợp đồng đó sống — mỗi node parse ĐÚNG MỘT lần
 * và parse chính `intro` (không phải `source`, để không parse chồng phần con).
 */
describe('renderNodes — dựng HTML sẵn cho cả cây', () => {
  const tree = () => buildMarkdownBlocks(DOC_A, { withFrontmatter: true })[2].children

  it('mỗi node parse đúng một lần, và parse `intro` chứ không phải `source`', () => {
    const render = vi.fn((md: string) => `<p>${md.length}</p>`)
    const nodes = renderNodes(tree(), render)

    // 3 node trong cây (A.1, A.1.1, A.2) ⇒ đúng 3 lần parse, không hơn.
    expect(render).toHaveBeenCalledTimes(3)
    const src = tree()
    expect(render).toHaveBeenCalledWith(src[0].intro)
    expect(render).toHaveBeenCalledWith(src[0].children[0].intro)
    expect(render).toHaveBeenCalledWith(src[1].intro)
    // `A.1` có con ⇒ `intro` ngắn hơn `source`, chứng tỏ không parse chồng.
    expect(src[0].intro.length).toBeLessThan(src[0].source.length)
    expect(nodes[0].html).toBe(`<p>${src[0].intro.length}</p>`)
  })

  it('giữ nguyên hình dạng cây và mọi trường của `MarkdownNode`', () => {
    const nodes = renderNodes(tree(), (md) => md)
    expect(nodes.map((n) => n.heading)).toEqual(['A.1', 'A.2'])
    expect(nodes[0].children.map((n) => n.heading)).toEqual(['A.1.1'])
    expect(nodes[0].source).toBe(tree()[0].source)
  })

  it('cây rỗng ⇒ mảng rỗng, không gọi render lần nào', () => {
    const render = vi.fn((md: string) => md)
    expect(renderNodes([], render)).toEqual([])
    expect(render).not.toHaveBeenCalled()
  })
})

/**
 * TC-G08 ở tầng thuần: `blockLineRanges` của `ArtifactPanel` và `getSectionSource`
 * của inline edit đều coi `block.source` là chuỗi con nguyên văn, đúng thứ tự —
 * và chỉ số block phải TRÙNG KHÍT với `splitMarkdownSections`, kể cả khi tài liệu
 * có mục con. Đây là hợp đồng GHI FILE: lệch một chỉ số là ghi đè nhầm section.
 */
describe('buildMarkdownBlocks — chỉ số block là hợp đồng của inline edit (TC-G07, TC-G08)', () => {
  const SAMPLES = [
    DOC_A,
    '## A\n\na\n\n## B\n\nb',
    'mở đầu\n\n## A\n\n### A.1\n\nx\n\n## B\n\n### B.1\n\ny',
    '## A\n\n```md\n## trong fence\n```\n',
    'không có heading nào',
  ]

  it('nguồn từng block trùng khít `splitMarkdownSections`, kể cả khi có mục con', () => {
    for (const src of SAMPLES) {
      expect(buildMarkdownBlocks(src).map((b) => b.source)).toEqual(splitMarkdownSections(src))
    }
  })

  it('mỗi `source` là chuỗi con NGUYÊN VĂN, đúng thứ tự, của tài liệu', () => {
    for (const src of SAMPLES) {
      let from = 0
      for (const block of buildMarkdownBlocks(src)) {
        const idx = src.indexOf(block.source, from)
        expect(idx).toBeGreaterThanOrEqual(0)
        from = idx + block.source.length
      }
    }
  })
})
