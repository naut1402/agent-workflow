import { describe, expect, it, vi, beforeEach } from 'vitest'
import { parseMarkdown } from '@/frontend/lib/markdownLib'

// `renderMermaid` dynamic-imports the real `mermaid` package, which needs full
// browser canvas/SVG layout APIs that jsdom doesn't provide — mock it so the
// tests only exercise our own short-circuit logic, not mermaid's renderer.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    // Simulate the real mermaid.run() side effect (replacing the node's raw
    // text with a rendered `<svg>`) so the short-circuit's `hasSvg` check
    // behaves like it would against the real library.
    run: vi.fn(async ({ nodes }: { nodes: HTMLElement[] }) => {
      for (const node of nodes) node.innerHTML = '<svg></svg>'
    }),
  },
}))

describe('parseMarkdown', () => {
  it('wraps mermaid fenced blocks in .mermaid divs', () => {
    const html = parseMarkdown('```mermaid\nflowchart LR\n  A --> B\n```')
    expect(html).toContain('class="mermaid"')
    expect(html).toContain('flowchart LR')
    expect(html).not.toContain('<pre><code class="language-mermaid">')
  })

  it('leaves regular code blocks unchanged', () => {
    const html = parseMarkdown('```js\nconst x = 1\n```')
    expect(html).toContain('<code')
    expect(html).not.toContain('class="mermaid"')
  })

  it('parses headings and paragraphs', () => {
    const html = parseMarkdown('# Title\n\nHello **world**')
    expect(html).toContain('<h1')
    expect(html).toContain('<strong>world</strong>')
  })
})

/**
 * The output of this function goes straight into `v-html` on four surfaces
 * (chat bubble, artifact panel, QA panel, log dialog), and markdown legitimately
 * carries raw HTML — so the dangerous subset has to be gone by the time it is
 * returned, without taking the surfaces' legitimate HTML with it.
 */
describe('parseMarkdown — dangerous HTML', () => {
  it('strips event-handler attributes but keeps the element', () => {
    const html = parseMarkdown('Xin chào <img src=x onerror="alert(1)"> hết')
    expect(html).not.toContain('onerror')
    expect(html).toContain('<img')
  })

  it('drops script tags entirely', () => {
    const html = parseMarkdown('<script>alert(1)</script>\n\nsau đó')
    expect(html).not.toContain('<script')
    expect(html).toContain('sau đó')
  })

  it('drops a javascript: href but keeps a relative one', () => {
    const html = parseMarkdown('[x](javascript:alert(1)) và [y](./real.md)')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="./real.md"')
  })

  it('keeps the raw HTML the artifact and QA panels rely on', () => {
    const collapsible = parseMarkdown('<details><summary>Chi tiết</summary>\n\nnội dung\n\n</details>')
    expect(collapsible).toContain('<details')
    expect(collapsible).toContain('<summary')

    const table = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(table).toContain('<table')

    // Task-list checkboxes are `<input type="checkbox">` — a tag an
    // over-eager allowlist would drop.
    const checklist = parseMarkdown('- [ ] chưa xong\n- [x] xong')
    expect(checklist).toContain('type="checkbox"')
  })
})

/**
 * Sanitising and swapping the mermaid fence are order-dependent, and both
 * orders produce plausible-looking HTML — these two cases are what tells them
 * apart. `renderMermaid` reads the diagram back via `node.textContent`, so what
 * matters is not the markup but what that property decodes to.
 */
describe('parseMarkdown — mermaid survives sanitising', () => {
  function mermaidSource(html: string): string {
    const host = document.createElement('div')
    host.innerHTML = html
    return host.querySelector<HTMLElement>('.mermaid')?.textContent ?? ''
  }

  it('an arrow reaches renderMermaid intact', () => {
    const html = parseMarkdown('\u0060\u0060\u0060mermaid\nflowchart LR\n  A --> B\n\u0060\u0060\u0060')
    expect(html).toContain('class="mermaid"')
    expect(mermaidSource(html)).toBe('flowchart LR\n  A --> B')
  })

  it('HTML inside a diagram stays text and never becomes a live element', () => {
    const html = parseMarkdown(
      '\u0060\u0060\u0060mermaid\nflowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B\n\u0060\u0060\u0060',
    )
    const host = document.createElement('div')
    host.innerHTML = html

    expect(host.querySelector('img')).toBeNull()
    // The tag is still spelled out in the markup, but escaped — it is diagram
    // source, not markup, and `&lt;` is what keeps it that way.
    expect(html).toContain('&lt;img')
    // Still readable as the diagram author wrote it.
    expect(mermaidSource(html)).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('renderMermaid', () => {
  // `mermaidLoaded`/`activeTheme` are module-level caches in markdown.ts, so
  // each test needs a fresh module instance (and a fresh `mermaid` mock) to
  // avoid state leaking between cases.
  beforeEach(() => {
    vi.resetModules()
    document.documentElement.removeAttribute('data-theme')
  })

  function mountMermaidNode(): HTMLElement {
    const root = document.createElement('div')
    const node = document.createElement('div')
    node.className = 'mermaid'
    node.textContent = 'flowchart LR\n  A --> B'
    root.appendChild(node)
    return root
  }

  it('short-circuits a no-op re-render: mermaid.run only runs once for unchanged source + theme', async () => {
    const { renderMermaid } = await import('@/frontend/lib/markdownLib')
    const mermaid = (await import('mermaid')).default
    vi.mocked(mermaid.run).mockClear()
    const root = mountMermaidNode()

    await renderMermaid(root)
    await renderMermaid(root)

    // Fixed behaviour: an unrelated re-render (e.g. the 1500ms task poll
    // giving ArtifactPanel a new `task` object identity) must NOT destroy +
    // redraw the diagram again when the source and theme haven't changed —
    // this is the "giật" bug §4.C fixes. (Characterization before the fix:
    // this second call used to also invoke mermaid.run(), i.e. 2 calls total.)
    expect(mermaid.run).toHaveBeenCalledTimes(1)
  })

  it('still re-renders when the theme changes between calls', async () => {
    const { renderMermaid } = await import('@/frontend/lib/markdownLib')
    const mermaid = (await import('mermaid')).default
    vi.mocked(mermaid.run).mockClear()
    const root = mountMermaidNode()

    document.documentElement.setAttribute('data-theme', 'dark')
    await renderMermaid(root)
    document.documentElement.setAttribute('data-theme', 'light')
    await renderMermaid(root)

    expect(mermaid.run).toHaveBeenCalledTimes(2)
  })
})

/**
 * The two halves joined up: sanitised `parseMarkdown` output mounted into a real
 * DOM node, then handed to `renderMermaid`. This is the only assertion that
 * covers the actual hand-off — `renderMermaid` reads the diagram back through
 * `node.textContent`, so an escaping mistake in `parseMarkdown` shows up here as
 * a mangled source reaching mermaid, not as an obviously broken string.
 */
describe('parseMarkdown → renderMermaid', () => {
  beforeEach(() => {
    vi.resetModules()
    document.documentElement.removeAttribute('data-theme')
  })

  it('hands mermaid the diagram source exactly as authored', async () => {
    const { parseMarkdown: parse, renderMermaid } = await import('@/frontend/lib/markdownLib')
    const mermaid = (await import('mermaid')).default
    vi.mocked(mermaid.run).mockClear()

    const container = document.createElement('div')
    // The `v-html` step, for real: a string assigned into innerHTML.
    container.innerHTML = parse('# Sơ đồ\n\n```mermaid\nflowchart LR\n  A --> B\n```')

    await renderMermaid(container)

    expect(mermaid.run).toHaveBeenCalledTimes(1)
    const [{ nodes }] = vi.mocked(mermaid.run).mock.calls[0] as [{ nodes: HTMLElement[] }]
    expect(nodes).toHaveLength(1)
    // `renderMermaid` snapshots what it read; the arrow must have survived the
    // sanitiser as an arrow, not as `--&gt;`.
    expect(nodes[0].getAttribute('data-mermaid-src')).toBe('flowchart LR\n  A --> B')
  })

  it('a diagram containing HTML reaches mermaid as text, with no live element', async () => {
    const { parseMarkdown: parse, renderMermaid } = await import('@/frontend/lib/markdownLib')
    const mermaid = (await import('mermaid')).default
    vi.mocked(mermaid.run).mockClear()

    const container = document.createElement('div')
    container.innerHTML = parse('```mermaid\nflowchart LR\n  A["<b>đậm</b>"] --> B\n```')

    await renderMermaid(container)

    expect(container.querySelector('b')).toBeNull()
    const [{ nodes }] = vi.mocked(mermaid.run).mock.calls[0] as [{ nodes: HTMLElement[] }]
    expect(nodes[0].getAttribute('data-mermaid-src')).toBe('flowchart LR\n  A["<b>đậm</b>"] --> B')
  })
})
