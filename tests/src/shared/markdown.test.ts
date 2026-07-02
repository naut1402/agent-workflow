import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '@/shared/markdown'

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
