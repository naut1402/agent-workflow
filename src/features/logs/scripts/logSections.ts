export type JobLogSectionKind = 'meta' | 'payload' | 'system-prompt' | 'output' | 'result'

export interface JobLogSection {
  title: string
  kind: JobLogSectionKind
  body: string
}

const MARKER_RE = /^(?:===|---) (.+?) (?:===|---)\s*$/

function kindForTitle(title: string): JobLogSectionKind {
  if (title.startsWith('Job metadata')) return 'meta'
  if (title.startsWith('Payload gửi cho runner')) return 'payload'
  if (title.startsWith('System prompt')) return 'system-prompt'
  if (title.startsWith('Phản hồi của runner')) return 'output'
  if (title.startsWith('Kết quả')) return 'result'
  return 'meta'
}

/**
 * Split a job log's raw text into labeled sections by its `=== … ===` /
 * `--- … ---` marker lines; no marker at all ⇒ one section with the raw text.
 */
export function parseJobLogSections(text: string): JobLogSection[] {
  const lines = text.split('\n')
  const sections: JobLogSection[] = []
  let currentTitle: string | null = null
  let currentKind: JobLogSectionKind = 'meta'
  let buffer: string[] = []

  const flush = (): void => {
    if (currentTitle === null) {
      if (buffer.some((l) => l.trim())) {
        sections.push({ title: '', kind: 'output', body: buffer.join('\n').trim() })
      }
      return
    }
    sections.push({ title: currentTitle, kind: currentKind, body: buffer.join('\n').trim() })
  }

  for (const line of lines) {
    const m = MARKER_RE.exec(line)
    if (!m) {
      buffer.push(line)
      continue
    }
    flush()
    buffer = []
    currentTitle = m[1].trim()
    currentKind = kindForTitle(currentTitle)
  }
  flush()

  if (sections.length === 0) return [{ title: '', kind: 'output', body: text }]
  return sections
}
