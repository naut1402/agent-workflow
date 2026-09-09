import { describe, expect, it } from 'vitest'

import {
  classifyArtifactHref,
  type ArtifactLinkTarget,
} from '@/features/monitor/lib/artifactLink'

type Row = [name: string, href: string, current: string, expected: ArtifactLinkTarget]

const rows: Row[] = [
  // ── TC-L01..L09 — resolve theo thư mục của artifact đang mở ────────────────
  ['sibling', 'design.md', 'investigate.md', { kind: 'artifact', name: 'design.md' }],
  ['dot-slash', './design.md', 'investigate.md', { kind: 'artifact', name: 'design.md' }],
  ['subdir', 'Tsub/qa.md', 'investigate.md', { kind: 'artifact', name: 'Tsub/qa.md' }],
  // Base là THƯ MỤC của artifact hiện tại, không phải gốc thư mục task.
  ['sibling in subdir', 'design.md', 'Tsub/qa.md', { kind: 'artifact', name: 'Tsub/design.md' }],
  ['up to task root', '../design.md', 'Tsub/qa.md', { kind: 'artifact', name: 'design.md' }],
  ['redundant segments', './sub/../design.md', 'investigate.md', { kind: 'artifact', name: 'design.md' }],
  ['self', 'investigate.md', 'investigate.md', { kind: 'artifact', name: 'investigate.md' }],
  ['hash is dropped', 'design.md#section-2', 'investigate.md', { kind: 'artifact', name: 'design.md' }],
  ['query is dropped', 'design.md?v=2', 'investigate.md', { kind: 'artifact', name: 'design.md' }],
  ['percent-encoded', 'my%20doc.md', 'investigate.md', { kind: 'artifact', name: 'my doc.md' }],
  ['deep subdir', 'a/b/c.md', 'investigate.md', { kind: 'artifact', name: 'a/b/c.md' }],

  // ── TC-L10..L15 — đường lỗi ────────────────────────────────────────────────
  ['escape one level', '../Tabc/design.md', 'investigate.md', { kind: 'invalid', reason: 'escape' }],
  ['escape two levels', '../../README.md', 'Tsub/qa.md', { kind: 'invalid', reason: 'escape' }],
  ['absolute system path', '/etc/passwd', 'investigate.md', { kind: 'invalid', reason: 'escape' }],
  ['absolute web path', '/design.md', 'investigate.md', { kind: 'invalid', reason: 'escape' }],
  ['non markdown', 'pipeline.yaml', 'investigate.md', { kind: 'invalid', reason: 'not-markdown' }],
  ['image', 'anh.png', 'investigate.md', { kind: 'invalid', reason: 'not-markdown' }],
  ['machine file', 'pipeline-export.json', 'investigate.md', { kind: 'invalid', reason: 'not-markdown' }],
  ['hidden file', '.hidden.md', 'investigate.md', { kind: 'invalid', reason: 'not-markdown' }],
  ['hidden dir', '.git/config.md', 'investigate.md', { kind: 'invalid', reason: 'not-markdown' }],
  ['uppercase extension', 'design.MD', 'investigate.md', { kind: 'invalid', reason: 'not-markdown' }],
  ['javascript scheme', 'javascript:alert(1)', 'investigate.md', { kind: 'invalid', reason: 'unsafe' }],
  ['javascript scheme mixed case', 'JavaScript:alert(1)', 'investigate.md', { kind: 'invalid', reason: 'unsafe' }],
  ['javascript scheme with control char', 'java\tscript:alert(1)', 'investigate.md', { kind: 'invalid', reason: 'unsafe' }],
  ['data scheme', 'data:text/html,<b>x</b>', 'investigate.md', { kind: 'invalid', reason: 'unsafe' }],
  ['vbscript scheme', 'vbscript:msgbox(1)', 'investigate.md', { kind: 'invalid', reason: 'unsafe' }],

  // ── TC-L16..L18 — link không phải artifact ─────────────────────────────────
  ['https', 'https://example.com/x', 'investigate.md', { kind: 'external', href: 'https://example.com/x' }],
  ['http', 'http://example.com', 'investigate.md', { kind: 'external', href: 'http://example.com' }],
  ['protocol relative', '//example.com/x', 'investigate.md', { kind: 'external', href: '//example.com/x' }],
  ['anchor only', '#muc-2', 'investigate.md', { kind: 'ignore' }],
  ['mailto', 'mailto:a@b.co', 'investigate.md', { kind: 'ignore' }],
  ['vscode scheme', 'vscode://file/x', 'investigate.md', { kind: 'ignore' }],
  ['empty', '', 'investigate.md', { kind: 'ignore' }],
  ['blank', '   ', 'investigate.md', { kind: 'ignore' }],
  ['query only', '?v=2', 'investigate.md', { kind: 'ignore' }],
]

describe('classifyArtifactHref', () => {
  it.each(rows)('%s: %j from %s', (_name, href, current, expected) => {
    expect(classifyArtifactHref(href, current)).toEqual(expected)
  })

  it('treats null/undefined href as ignore', () => {
    expect(classifyArtifactHref(null, 'investigate.md')).toEqual({ kind: 'ignore' })
    expect(classifyArtifactHref(undefined, 'investigate.md')).toEqual({ kind: 'ignore' })
  })

  it('trims surrounding whitespace before classifying', () => {
    expect(classifyArtifactHref('  design.md  ', 'investigate.md')).toEqual({
      kind: 'artifact',
      name: 'design.md',
    })
  })

  it('keeps a malformed percent-escape as-is instead of throwing', () => {
    expect(classifyArtifactHref('100%.md', 'investigate.md')).toEqual({
      kind: 'artifact',
      name: '100%.md',
    })
  })

  it('never returns a name that putArtifact would reject', () => {
    const hrefs = [
      'design.md',
      './design.md',
      'Tsub/qa.md',
      '../design.md',
      './sub/../design.md',
      'my%20doc.md',
      'a/b/c.md',
    ]
    for (const href of hrefs) {
      const target = classifyArtifactHref(href, 'Tsub/qa.md')
      if (target.kind !== 'artifact') continue
      expect(target.name.endsWith('.md')).toBe(true)
      expect(target.name.includes('..')).toBe(false)
      expect(target.name.startsWith('.')).toBe(false)
    }
  })
})
