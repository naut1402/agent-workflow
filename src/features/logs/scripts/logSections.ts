/**
 * Splits a job log's raw text into the sections `claude-code-cli.ts` /
 * `agenticApiProvider.ts` / `console-command.ts` already write with `=== ... ===` /
 * `--- ... ---` marker lines, so `JobLogDialog.vue` can render each part labeled instead
 * of dumping the whole file into one `<pre>`.
 */

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
  // Unrecognized marker (e.g. CLI providers' "--- Prompt ---", console-command's
  // "--- Extra args (từ prompt) ---") — treat as plain metadata text rather than
  // guessing it is markdown output.
  return 'meta'
}

/** Pure text parser — no DOM, so it is unit-testable without mounting the dialog. */
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

  // No marker matched anywhere (log predates this format, or is some other
  // shape entirely) — fall back to showing the raw text as one section.
  if (sections.length === 0) return [{ title: '', kind: 'output', body: text }]
  return sections
}
