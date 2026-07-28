import { z } from 'zod'

/**
 * Schemas for the NL chat surface (F0012): a floating chat that generates a
 * Task / Pipeline / Agent draft via the agent runner CLI (see
 * server/chat/nlChatSession.ts), instead of calling an LLM API directly.
 */

export const NL_CHAT_ENTITY_TYPES = ['task', 'pipeline', 'agent'] as const
export type NlChatEntityType = (typeof NL_CHAT_ENTITY_TYPES)[number]

/** Body for `POST /api/nl-chat/sessions` (starts a new chat session). */
export const StartNlChatRequest = z.object({
  entityType: z.enum(NL_CHAT_ENTITY_TYPES),
  message: z.string().min(1).max(20_000),
  runnerId: z.string().min(1).nullish(),
})
export type StartNlChatRequest = z.infer<typeof StartNlChatRequest>

/** Body for `POST /api/nl-chat/sessions/:id/messages` (continues a session). */
export const NlChatMessageRequest = z.object({
  message: z.string().min(1).max(20_000),
})
export type NlChatMessageRequest = z.infer<typeof NlChatMessageRequest>
