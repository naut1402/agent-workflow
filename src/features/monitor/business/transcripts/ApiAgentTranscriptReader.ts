import { joinPath } from '../../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../../backend/registry.js'
import { AbstractJsonlTranscriptReader, type TranscriptTurnDraft } from './AbstractJsonlTranscriptReader.js'

/**
 * Read the transcript an `AgenticApiProvider` subclass (openai/gemini/xai/anthropic
 * — see runner/business/providers/AgenticApiProvider.ts) wrote for a job, so task
 * chat can surface its tool-calls the same way it does for a CLI's own on-disk
 * transcript (ClaudeTranscriptReader / CursorTranscriptReader). Read-only
 * counterpart of `agentTranscriptStore.ts::appendTranscriptTurn` — kept in
 * `monitor` (not `runner`) to match where the other transcript readers live.
 *
 * One instance per provider id: the id is both the directory the store writes
 * under and the `transcriptProvider` label the chat reports.
 */
export class ApiAgentTranscriptReader extends AbstractJsonlTranscriptReader {
  constructor(readonly label: string) {
    super()
  }

  /** `<registryHome>/agent-sdk-transcripts/<providerId>/<sessionId>.jsonl` — existence is checked by reading it. */
  protected locate(sessionId: string): string {
    return joinPath(registryHome(), 'agent-sdk-transcripts', this.label, `${sessionId}.jsonl`)
  }

  /** Missing/corrupt file → `file: null`, unlike the CLI readers which report the path they located. */
  protected fileWhenUnreadable(): string | null {
    return null
  }

  protected turnsOfEntry(entry: Record<string, unknown>, includeToolActivity: boolean): TranscriptTurnDraft[] {
    const role = entry.role
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') return []
    if (role === 'tool' && !includeToolActivity) return []
    const text = typeof entry.text === 'string' ? entry.text : ''
    if (!text.trim()) return []
    return [
      {
        role,
        ...this.clip(text),
        tool: typeof entry.tool === 'string' ? entry.tool : undefined,
        at: typeof entry.at === 'string' ? entry.at : undefined,
      },
    ]
  }
}
