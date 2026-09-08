import DOMPurify from 'dompurify'
import { marked } from 'marked'

const MERMAID_PRE =
  /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g

/**
 * Parse markdown to HTML; mermaid fenced blocks become `.mermaid` divs.
 *
 * The output goes straight into `v-html` on four surfaces (chat bubble,
 * artifact panel, QA panel, log dialog), so it is sanitised here — one hop
 * instead of one per surface.
 *
 * Sanitising runs before the mermaid swap so the sanitiser only ever sees
 * `marked`'s own output. `class` survives DOMPurify's default allowlist, so
 * the fenced mermaid block is still matchable afterwards.
 *
 * The invariant that actually keeps this safe is that the diagram body stays
 * HTML-escaped: `renderMermaid` reads it back through `node.textContent`,
 * which the browser decodes exactly once. Decoding it here by hand instead
 * would turn `&lt;img onerror=…&gt;` inside a mermaid fence into a live tag,
 * outside the sanitiser's reach — the fence is diagram source, not markup.
 */
export function parseMarkdown(source: string): string {
  const html = DOMPurify.sanitize(marked.parse(source || '') as string)
  return html.replace(MERMAID_PRE, (_, body: string) => `<div class="mermaid">${body.trim()}</div>\n`)
}

function mermaidTheme(): 'dark' | 'default' {
  const scheme = document.documentElement.getAttribute('data-theme')
  if (scheme === 'light') return 'default'
  return 'dark'
}

let mermaidLoaded: typeof import('mermaid') | null = null
let activeTheme: string | null = null

/** Render mermaid diagrams inside a container (after v-html mount). */
export async function renderMermaid(rootEl: HTMLElement | null | undefined): Promise<void> {
  if (!rootEl) return
  const nodes = rootEl.querySelectorAll<HTMLElement>('.mermaid')
  if (!nodes.length) return

  const theme = mermaidTheme()

  // Short-circuit: skip nodes already rendered with the same source + same
  // theme. Needed because ArtifactPanel calls this on EVERY re-render
  // (onUpdated), including re-renders caused by the `task` prop changing
  // identity every ~1500ms poll tick rather than the mermaid content actually
  // changing — previously every such tick destroyed and redrew the existing
  // SVG unconditionally, causing a visible flicker.
  const toRender: HTMLElement[] = []
  for (const node of nodes) {
    const hasSvg = !!node.querySelector('svg')
    const knownSrc = node.getAttribute('data-mermaid-src')
    const knownTheme = node.getAttribute('data-mermaid-theme')
    if (hasSvg && knownSrc && knownTheme === theme) continue // unchanged, keep the existing SVG

    const src = knownSrc ?? node.textContent?.trim() ?? ''
    if (!src) continue
    node.setAttribute('data-mermaid-src', src)
    node.setAttribute('data-mermaid-theme', theme)
    if (hasSvg) node.textContent = src // source or theme really changed — reset before redrawing
    node.removeAttribute('data-processed')
    toRender.push(node)
  }
  if (!toRender.length) return

  if (!mermaidLoaded) {
    mermaidLoaded = await import('mermaid')
  }
  if (activeTheme !== theme) {
    mermaidLoaded.default.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })
    activeTheme = theme
  }

  await mermaidLoaded.default.run({ nodes: toRender })
}
