import { z } from 'zod'

/**
 * Schemas for the NL chat surface (F0012): a floating chat that generates a
 * Task / Pipeline / Agent draft via the agent runner CLI (see
 * server/chat/nlChatSession.ts), instead of calling an LLM API directly.
 */

export const NL_CHAT_ENTITY_TYPES = ['task', 'pipeline', 'agent', 'automation'] as const
export type NlChatEntityType = (typeof NL_CHAT_ENTITY_TYPES)[number]

/**
 * Body for `POST /api/nl-chat/sessions` (starts a new chat session).
 *
 * `entityType` is optional: the chat surface opens as a normal conversation
 * and lets the agent infer what the user wants to create (task / pipeline /
 * agent / automation) — see design.md F0012 §4.2 "auto mode". Callers that
 * already know the target entity may still pin it.
 */
export const StartNlChatRequest = z.object({
  entityType: z.enum(NL_CHAT_ENTITY_TYPES).nullish(),
  message: z.string().min(1).max(20_000),
  runnerId: z.string().min(1).nullish(),
})
export type StartNlChatRequest = z.infer<typeof StartNlChatRequest>

/** Body for `POST /api/nl-chat/sessions/:id/messages` (continues a session). */
export const NlChatMessageRequest = z.object({
  message: z.string().min(1).max(20_000),
})
export type NlChatMessageRequest = z.infer<typeof NlChatMessageRequest>

// ── Chat attachments (POST /api/nl-chat/attachments) ───────────────────────
// One source of truth for the limits: the composer rejects up front, the route
// rejects again — a FE-only check is not a guard.

/** Per-file size ceiling. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Files allowed in a single send. */
export const MAX_ATTACHMENTS_PER_TURN = 5

const ALLOWED_MIME_PREFIXES = ['image/', 'text/'] as const
const ALLOWED_MIME_EXACT = ['application/pdf', 'application/json'] as const
/** Browsers report an empty `type` for some extensions (`.md`) — fall back to these. */
const ALLOWED_EXTENSIONS = ['.md', '.txt', '.json', '.pdf', '.log', '.csv', '.yaml', '.yml'] as const

export function isAllowedAttachment(name: string, mime: string): boolean {
  const type = (mime || '').toLowerCase()
  if (ALLOWED_MIME_PREFIXES.some((p) => type.startsWith(p))) return true
  if ((ALLOWED_MIME_EXACT as readonly string[]).includes(type)) return true
  if (!type) {
    const lower = String(name || '').toLowerCase()
    return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
  }
  return false
}

/** One saved file, as returned by the upload route — `path` is what the agent reads. */
export interface UploadedAttachment {
  name: string
  path: string
  size: number
  type: string
}
