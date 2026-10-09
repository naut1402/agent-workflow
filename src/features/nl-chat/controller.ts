// fallow-ignore-file unused-file -- `registerFeatureRoutes` (src/backend/apiServer.ts)
// discovers every `features/<name>/api.ts` by scanning the directory and
// dynamic-importing it, and that module is what imports this controller. Static
// reachability cannot follow that edge, so the file reads as unreachable.
import type { Context } from 'hono'
import { AbstractController } from '../../backend/http/AbstractController.js'
import type { HonoEnv } from '../../backend/http/types.js'
import { StartNlChatRequest, NlChatMessageRequest } from './schemas/nlChat.js'
import { emitAudit } from '../../backend/log/store.js'
import {
  startNlChatSession,
  continueNlChatSession,
  getNlChatTurn,
  cancelNlChatSession,
  isNlChatSessionId,
  ensureNlChatBuilderAgent,
  scanCustomAgents,
  buildNlChatCatalog,
  renderNlChatCatalog,
  saveChatAttachments,
  checkAttachmentLimits,
  loadScanPatternsConfig,
} from './business/index.js'
import type { IncomingAttachment, NlChatEntityType } from './business/index.js'

function readTaskIdField(form: FormData): string | undefined {
  const field = form.get('taskId')
  if (typeof field !== 'string' || !field) return undefined
  return field
}

// xem docs/architecture/code/nl-chat.md §3
async function readAttachmentForm(
  c: Context<HonoEnv>,
): Promise<{ files: IncomingAttachment[]; taskId?: string } | { status: number; error: string }> {
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return { status: 400, error: 'invalid multipart body' }
  }

  const raw = form.getAll('files').filter((v): v is File => v instanceof File)
  const refusal = checkAttachmentLimits(raw)
  if (refusal) return refusal

  const files: IncomingAttachment[] = []
  for (const f of raw) {
    files.push({
      name: f.name,
      type: f.type,
      size: f.size,
      bytes: new Uint8Array(await f.arrayBuffer()),
    })
  }
  return { files, taskId: readTaskIdField(form) }
}

/**
 * NL chat surface: a floating chat that generates a Task / Pipeline / Agent draft
 * by driving the agent runner CLI (`submitJob` / `sendTaskFeedback`). The `:id`
 * here is a chat session id (`nlchat-<hex>`), never a real task id.
 */
export class NlChatController extends AbstractController {
  // xem docs/architecture/code/nl-chat.md §2
  private async renderCatalogContext(
    root: string,
    entityType?: NlChatEntityType | null,
  ): Promise<string | undefined> {
    try {
      const catalog = await buildNlChatCatalog(root, {
        scanCustomAgents,
        scanPatterns: loadScanPatternsConfig(),
      })
      return renderNlChatCatalog(catalog, entityType) || undefined
    } catch (e) {
      console.warn(`[nl-chat] không dựng được catalog: ${String((e as Error)?.message || e)}`)
      return undefined
    }
  }

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
    const extraContext = await this.renderCatalogContext(root, entityType)

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
    const { root } = gate

    const id = this.c.req.param('id')
    if (!id || !isNlChatSessionId(id)) return this.badRequest('invalid chat session id')

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = NlChatMessageRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }

    const projectId = this.projectId || ''
    const result = await continueNlChatSession(id, projectId, parsed.data.message, (entityType) =>
      this.renderCatalogContext(root, entityType),
    )
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
   * Files dropped into the chat composer, written under the data root; the FE
   * appends their paths to the message.
   * xem docs/architecture/code/nl-chat.md §3
   */
  async uploadAttachments() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error

    const parsed = await readAttachmentForm(this.c)
    if ('error' in parsed) return this.json(parsed.status, { error: parsed.error })

    const result = await saveChatAttachments(gate.root, parsed.files, { taskId: parsed.taskId })
    if ('error' in result) return this.json(result.status, { error: result.error })

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
