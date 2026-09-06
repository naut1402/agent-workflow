import { AbstractController } from '../../core/http/AbstractController.js'
import { StartNlChatRequest, NlChatMessageRequest } from './schemas/nlChat.js'
import { emitAudit } from '../../core/log/store.js'
import {
  startNlChatSession,
  continueNlChatSession,
  getNlChatTurn,
  cancelNlChatSession,
  isNlChatSessionId,
  ensureNlChatBuilderAgent,
  scanCustomAgents,
  buildCatalog,
  saveChatAttachments,
  checkAttachmentLimits,
} from './business/index.js'

/**
 * NL chat surface (F0012): a floating chat that generates a Task / Pipeline /
 * Agent draft by driving the real agent runner CLI (`submitJob`/
 * `sendTaskFeedback`), instead of calling an LLM API directly from a route
 * (see design.md §2 quyết định #2). Kept separate from tasks — the `:id` here
 * is a chat session id (`nlchat-<hex>`), never a real task id, and
 * `POST /api/tasks/:id/feedback` intentionally 404s on it (readState guard).
 */
export class NlChatController extends AbstractController {
  async createSession() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = StartNlChatRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }

    await ensureNlChatBuilderAgent(root)

    const projectId = this.projectId || ''
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
      projectId: this.projectId,
      detail: { entityType: entityType ?? 'auto', jobId: job.id },
    })

    return this.created({ chatSessionId, job })
  }

  async postMessage() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error

    const id = this.c.req.param('id')
    if (!id || !isNlChatSessionId(id)) return this.badRequest('invalid chat session id')

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = NlChatMessageRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }

    const projectId = this.projectId || ''
    const result = await continueNlChatSession(id, projectId, parsed.data.message)
    if ('error' in result) {
      return this.json(result.status || 400, { error: result.error, chatSessionId: id })
    }

    emitAudit({
      op: 'update',
      entity: 'nl-chat-session',
      identifier: id,
      projectId: this.projectId,
      detail: { jobId: result.job.id },
    })

    return this.created({ job: result.job })
  }

  async getSession() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error

    const id = this.c.req.param('id')
    if (!id || !isNlChatSessionId(id)) return this.badRequest('invalid chat session id')

    const turn = getNlChatTurn(id)
    if (turn.status === 'error') return this.json(404, { chatSessionId: id, ...turn })
    return this.ok({ chatSessionId: id, ...turn })
  }

  async cancelSession() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error

    const id = this.c.req.param('id')
    if (!id || !isNlChatSessionId(id)) return this.badRequest('invalid chat session id')

    const projectId = this.projectId || ''
    cancelNlChatSession(id, projectId)

    emitAudit({
      op: 'update',
      entity: 'nl-chat-session',
      identifier: id,
      projectId: this.projectId,
      detail: { action: 'cancel' },
    })

    return this.ok({ cancelled: true, chatSessionId: id })
  }

  /**
   * Files dropped into the chat composer. They are written under the data root
   * and the FE appends their paths to the message, so the agent reads them from
   * disk — no attachment field on the message/feedback schemas.
   *
   * Body is parsed with `c.req.formData()`: the hand-rolled multipart parsers
   * in knowledge/agent-editor coerce the body to a string and corrupt binaries.
   */
  async uploadAttachments() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    let form: FormData
    try {
      form = await this.c.req.formData()
    } catch {
      return this.badRequest('invalid multipart body')
    }

    const raw = form.getAll('files').filter((v): v is File => v instanceof File)
    const taskIdField = form.get('taskId')

    // Refuse on the File metadata BEFORE `arrayBuffer()`: reading first would put
    // an oversized upload entirely in memory just to reject it afterwards.
    const refusal = checkAttachmentLimits(raw)
    if (refusal) return this.json(refusal.status, { error: refusal.error })

    const files = []
    for (const f of raw) {
      files.push({
        name: f.name,
        type: f.type,
        size: f.size,
        bytes: new Uint8Array(await f.arrayBuffer()),
      })
    }

    const result = await saveChatAttachments(root, files, {
      taskId: typeof taskIdField === 'string' && taskIdField ? taskIdField : undefined,
    })
    if ('error' in result) return this.json(result.status, { error: result.error })

    // Audit carries the sanitized names + sizes only — never file contents.
    emitAudit({
      op: 'create',
      entity: 'nl-chat-attachment',
      identifier: result.saved.map((f) => f.name).join(', '),
      projectId: this.projectId,
      detail: {
        count: result.saved.length,
        bytes: result.saved.reduce((sum, f) => sum + f.size, 0),
      },
    })

    return this.created({ files: result.saved })
  }
}
