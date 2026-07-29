import { z } from 'zod'

/**
 * Schemas for the NL chat surface (F0012): a floating chat that generates a
 * Task / Pipeline / Agent draft via the agent runner CLI (see
 * server/chat/nlChatSession.ts), instead of calling an LLM API directly.
 */

export const NL_CHAT_ENTITY_TYPES = ['task', 'pipeline', 'agent'] as const
export type NlChatEntityType = (typeof NL_CHAT_ENTITY_TYPES)[number]

/**
 * Body for `POST /api/nl-chat/sessions` (starts a new chat session).
 *
 * `entityType` is optional: the chat surface opens as a normal conversation
 * and lets the agent infer what the user wants to create (task / pipeline /
 * agent) — see design.md F0012 §4.2 "auto mode". Callers that already know
 * the target entity may still pin it.
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
