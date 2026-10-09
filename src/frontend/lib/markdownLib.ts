import DOMPurify from 'dompurify'
import { marked } from 'marked'

const MERMAID_PRE =
  /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g

/**
 * Parse markdown to sanitised HTML (DOMPurify); mermaid fenced blocks become `.mermaid` divs.
 * xem docs/architecture/code/frontend.md §2
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

  const toRender: HTMLElement[] = []
  for (const node of nodes) {
    const hasSvg = !!node.querySelector('svg')
    const knownSrc = node.getAttribute('data-mermaid-src')
    const knownTheme = node.getAttribute('data-mermaid-theme')
    if (hasSvg && knownSrc && knownTheme === theme) continue

    const src = knownSrc ?? node.textContent?.trim() ?? ''
    if (!src) continue
    node.setAttribute('data-mermaid-src', src)
    node.setAttribute('data-mermaid-theme', theme)
    if (hasSvg) node.textContent = src
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
