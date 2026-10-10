import type {
  ReadTranscriptOptions,
  TranscriptProviderLabel,
  TranscriptReadResult,
  TranscriptReader,
} from './TranscriptReader.js'

/**
 * Composite: try each reader in order and answer with the first one that finds
 * a transcript file, reporting that reader's label. When none finds one, the
 * primary (first) reader's empty result is returned under this composite's own
 * `label` — the provider hint the selector resolved, not a reader's.
 */
export class FallbackTranscriptReader implements TranscriptReader {
  constructor(
    readonly label: TranscriptProviderLabel,
    private readonly readers: readonly [TranscriptReader, ...TranscriptReader[]],
  ) {}

  read(sessionId: string, workspace?: string, opts: ReadTranscriptOptions = {}): TranscriptReadResult {
    const [first, ...rest] = this.readers
    const primary = first.read(sessionId, workspace, opts)
    if (primary.file) return primary
    for (const reader of rest) {
      const result = reader.read(sessionId, workspace, opts)
      if (result.file) return result
    }
    return { ...primary, provider: this.label }
  }

  /** Nothing matched → the primary reader explains what was looked for. */
  missingReason(): string {
    return this.readers[0].missingReason()
  }
}
