/**
 * Parse the `nl-chat-builder` agent's raw stdout into either a follow-up
 * question (still gathering info) or a ready draft. See design.md §4.2
 * "Output contract của agent nl-chat-builder".
 *
 * Contract: if the agent has enough information to finalize a draft, the
 * FIRST line of its (trimmed) output must be exactly `===DRAFT_READY===`,
 * followed by a fenced ```json block containing the draft. Anything else is
 * treated as a plain-text follow-up question.
 */

export type NlChatEntityType = 'task' | 'pipeline' | 'agent'

export type BuilderTurn =
  | { kind: 'question'; text: string }
  | { kind: 'draft'; entityType?: NlChatEntityType; draft: Record<string, unknown> }

const DRAFT_READY_SENTINEL = '===DRAFT_READY==='

/** Fallback shown to the user when the sentinel is present but JSON parsing fails. */
const DRAFT_PARSE_ERROR_MESSAGE = 'Draft sinh lỗi, vui lòng thử lại.'

export function parseBuilderOutput(stdout: string): BuilderTurn {
  const trimmed = (stdout || '').trim()
  if (!trimmed.startsWith(DRAFT_READY_SENTINEL)) {
    return { kind: 'question', text: trimmed }
  }

  const rest = trimmed.slice(DRAFT_READY_SENTINEL.length)
  const match = rest.match(/\{[\s\S]*\}/)
  if (!match) {
    return { kind: 'question', text: DRAFT_PARSE_ERROR_MESSAGE }
  }

  try {
    const parsed = JSON.parse(match[0])
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'question', text: DRAFT_PARSE_ERROR_MESSAGE }
    }
    return { kind: 'draft', draft: parsed as Record<string, unknown> }
  } catch {
    return { kind: 'question', text: DRAFT_PARSE_ERROR_MESSAGE }
  }
}
