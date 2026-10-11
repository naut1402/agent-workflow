import { readTextFileSync } from '../../../../backend/lib/fileHelper.js'
import {
  clipTurnText,
  type ReadTranscriptOptions,
  type TranscriptProviderLabel,
  type TranscriptReadResult,
  type TranscriptReader,
  type TranscriptResult,
  type TranscriptTurn,
} from './TranscriptReader.js'

/** Newest-N turns returned, to bound both memory and payload size. */
const MAX_TURNS = 200

/** Session ids become file names — anything beyond `[\w-]` (path traversal) is rejected outright. */
export function isSafeSessionId(sessionId: string): boolean {
  return Boolean(sessionId) && !/[^\w-]/.test(sessionId)
}

/** A turn as one JSONL entry yields it — `index` is assigned by the template. */
export type TranscriptTurnDraft = Omit<TranscriptTurn, 'index'>

/**
 * Template method shared by every one-JSON-object-per-line transcript:
 * locate the file → read it (whole file or a tail) → parse line by line,
 * skipping half-written lines → map each entry to turns → newest-N window →
 * poll cursor. Implementations supply only the file location and the per-entry
 * mapping (plus, optionally, how much of the file to read).
 */
export abstract class AbstractJsonlTranscriptReader implements TranscriptReader {
  abstract readonly label: TranscriptProviderLabel

  read(sessionId: string, workspace?: string, opts: ReadTranscriptOptions = {}): TranscriptReadResult {
    const file = this.locate(sessionId, workspace)
    if (!file) return { turns: [], total: 0, file: null, provider: this.label }
    const parsed = this.parse(file, opts)
    if (parsed) return { ...parsed, file, provider: this.label }
    return { turns: [], total: 0, file: this.fileWhenUnreadable(file), provider: this.label }
  }

  /** Parse an already-located transcript file. Unreadable file → empty result. */
  // fallow-ignore-next-line unused-class-member -- seam cho test (dòng test/ đọc file transcript dựng sẵn), source chỉ gọi `read`
  readFile(file: string, opts: ReadTranscriptOptions = {}): TranscriptResult {
    return this.parse(file, opts) ?? { turns: [], total: 0 }
  }

  missingReason(): string {
    return 'Không tìm thấy transcript trên disk cho session id này. Session có thể thuộc provider khác hoặc cwd không khớp.'
  }

  /** Path of the session's transcript, or `null` when it cannot be found. */
  protected abstract locate(sessionId: string, workspace?: string): string | null

  /** Turns carried by one parsed JSONL entry (usually 0 or 1, more for tool activity). */
  protected abstract turnsOfEntry(entry: Record<string, unknown>, includeToolActivity: boolean): TranscriptTurnDraft[]

  /** File contents to parse. Default: the whole file. */
  protected readTextOf(file: string): string {
    return readTextFileSync(file)
  }

  /** `file` reported when the located file cannot be read. Default: the path itself. */
  protected fileWhenUnreadable(file: string): string | null {
    return file
  }

  protected clip(text: string): { text: string; truncated?: boolean } {
    return clipTurnText(text)
  }

  private parse(file: string, opts: ReadTranscriptOptions): TranscriptResult | null {
    let raw: string
    try {
      raw = this.readTextOf(file)
    } catch {
      return null
    }

    const includeToolActivity = opts.includeToolActivity !== false
    const all: TranscriptTurn[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line)
      } catch {
        continue // a half-written trailing line while the runner is still writing
      }
      for (const turn of this.turnsOfEntry(entry, includeToolActivity)) {
        all.push({ index: all.length, ...turn })
      }
    }

    // Re-index after the newest-N window so `index` stays a stable cursor into
    // the returned sequence.
    const windowed = all.slice(Math.max(0, all.length - MAX_TURNS))
    const from = opts.fromIndex ?? 0
    return { turns: windowed.filter((t) => t.index >= from), total: all.length }
  }
}
