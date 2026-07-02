import { marked } from 'marked'

const MERMAID_PRE =
  /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Parse markdown to HTML; mermaid fenced blocks become `.mermaid` divs. */
export function parseMarkdown(source: string): string {
  const html = marked.parse(source || '') as string
  return html.replace(MERMAID_PRE, (_, body: string) => {
    const text = decodeHtmlEntities(body.trim())
    return `<div class="mermaid">${text}</div>\n`
  })
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

  if (!mermaidLoaded) {
    mermaidLoaded = await import('mermaid')
  }

  const theme = mermaidTheme()
  if (activeTheme !== theme) {
    mermaidLoaded.default.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })
    activeTheme = theme
  }

  for (const node of nodes) {
    const src = node.getAttribute('data-mermaid-src') ?? node.textContent?.trim() ?? ''
    if (!src) continue
    node.setAttribute('data-mermaid-src', src)
    if (node.querySelector('svg')) {
      node.textContent = src
    }
    node.removeAttribute('data-processed')
  }

  await mermaidLoaded.default.run({ nodes: Array.from(nodes) })
}
