import { describe, expect, it, vi, beforeEach } from 'vitest'
import { parseMarkdown } from '@/core/lib/markdownLib'

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
    const { renderMermaid } = await import('@/core/lib/markdownLib')
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
    const { renderMermaid } = await import('@/core/lib/markdownLib')
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
