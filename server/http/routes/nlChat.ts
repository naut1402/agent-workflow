import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody, unknownProject } from '../respond.js'
import { emitAudit } from '../../logging/store.js'
import { StartNlChatRequest, NlChatMessageRequest } from '../../../shared/schemas/nlChat.js'
import { ensureNlChatBuilderAgent, scanCustomAgents } from '../../agents/index.js'
import { buildCatalog } from '../../catalog/index.js'
import {
  startNlChatSession,
  continueNlChatSession,
  getNlChatTurn,
  cancelNlChatSession,
  isNlChatSessionId,
} from '../../chat/nlChatSession.js'

/**
 * NL chat surface (F0012): a floating chat that generates a Task / Pipeline /
 * Agent draft by driving the real agent runner CLI (`submitJob`/
 * `sendTaskFeedback`), instead of calling an LLM API directly from a route
 * (see design.md §2 quyết định #2). Kept separate from `tasks.ts` — the
 * `:id` here is a chat session id (`nlchat-<hex>`), never a real task id, and
 * `POST /api/tasks/:id/feedback` intentionally 404s on it (readState guard).
 */
export function registerNlChatRoutes(app: Hono<HonoEnv>): void {
  app.post('/api/nl-chat/sessions', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = StartNlChatRequest.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid request', details: parsed.error.flatten() })
    }

    await ensureNlChatBuilderAgent(root)

    const projectId = c.get('projectId') || ''
    const entityType = parsed.data.entityType ?? undefined
    let extraContext: string | undefined
    // Auto mode may end up drafting a pipeline, so the catalog refs must be in
    // the turn-1 context there too — not only when 'pipeline' was pinned.
    if (entityType === 'pipeline' || !entityType) {
      const catalog = await buildCatalog(root, { scanCustomAgents })
      const refs = (catalog.agents || [])
        .map((a: any) => a?.id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      extraContext = `Danh sách agent ref hợp lệ cho step.agent (chỉ được dùng các giá trị này):\n${refs.map((r) => `- ${r}`).join('\n')}`
    }

    const { chatSessionId, job } = startNlChatSession({
      projectId,
      entityType,
      message: parsed.data.message,
      runnerId: parsed.data.runnerId ?? undefined,
      extraContext,
      devTeamRoot: root,
    })

    emitAudit({
      op: 'create',
      entity: 'nl-chat-session',
      identifier: chatSessionId,
      projectId: c.get('projectId'),
      detail: { entityType: entityType ?? 'auto', jobId: job.id },
    })

    return j(c, 201, { chatSessionId, job })
  })

  app.post('/api/nl-chat/sessions/:id/messages', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.param('id')
    if (!id || !isNlChatSessionId(id)) return j(c, 400, { error: 'invalid chat session id' })

    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = NlChatMessageRequest.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid request', details: parsed.error.flatten() })
    }

    const projectId = c.get('projectId') || ''
    const result = continueNlChatSession(id, projectId, parsed.data.message)
    if ('error' in result) return j(c, result.status || 400, { error: result.error, chatSessionId: id })

    emitAudit({
      op: 'update',
      entity: 'nl-chat-session',
      identifier: id,
      projectId: c.get('projectId'),
      detail: { jobId: result.job.id },
    })

    return j(c, 201, { job: result.job })
  })

  app.get('/api/nl-chat/sessions/:id', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.param('id')
    if (!id || !isNlChatSessionId(id)) return j(c, 400, { error: 'invalid chat session id' })

    const turn = getNlChatTurn(id)
    if (turn.status === 'error') return j(c, 404, { chatSessionId: id, ...turn })
    return j(c, 200, { chatSessionId: id, ...turn })
  })

  app.post('/api/nl-chat/sessions/:id/cancel', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.param('id')
    if (!id || !isNlChatSessionId(id)) return j(c, 400, { error: 'invalid chat session id' })

    const projectId = c.get('projectId') || ''
    cancelNlChatSession(id, projectId)

    emitAudit({
      op: 'update',
      entity: 'nl-chat-session',
      identifier: id,
      projectId: c.get('projectId'),
      detail: { action: 'cancel' },
    })

    return j(c, 200, { cancelled: true, chatSessionId: id })
  })
}
