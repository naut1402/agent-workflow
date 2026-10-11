import { AbstractController } from '../../backend/http/AbstractController.js'
import { emitAudit } from '../../backend/log/store.js'
import { emitEntity } from '../../backend/events/index.js'
import { McpServerTestSchema, McpServerUpsertSchema } from './schemas/mcpServer.js'
import {
  McpClient,
  McpRegistry,
  RemoteMcpServer,
  credentialResolver,
  mcpRegistry,
} from './business/index.js'

export class McpController extends AbstractController {
  /** Secret không bao giờ rời tiến trình qua response — mọi cấu hình trả về đều mask. */
  listServers() {
    return this.ok({ servers: mcpRegistry.list().map((s) => s.masked()) })
  }

  async upsertServer() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = McpServerUpsertSchema.safeParse(b.value?.server ?? b.value)
    if (!parsed.success) return this.badRequest(firstIssue(parsed.error))

    const input = parsed.data
    // xem docs/mcp/client.md §4
    if (input.transport !== 'stdio') {
      try {
        RemoteMcpServer.assertEndpoint(input.url)
      } catch (err: any) {
        return this.badRequest(String(err?.message ?? err))
      }
    }

    const result = mcpRegistry.upsert(input)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })

    emitAudit({ op: 'update', entity: 'mcp-server', identifier: result.server.id, projectId: null })
    emitEntity('updated', 'mcp-server', { id: result.server.id, projectId: null })
    // xem docs/architecture/code/mcp.md §9
    const warnings = [...result.warnings, ...result.server.warnings()]
    return this.ok({ saved: true, server: result.server.masked(), warnings })
  }

  deleteServer() {
    const result = mcpRegistry.delete(this.c.req.query('id') || '')
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    if (result.deleted) {
      emitAudit({ op: 'delete', entity: 'mcp-server', identifier: result.id, projectId: null })
      emitEntity('deleted', 'mcp-server', { id: result.id, projectId: null })
    }
    return this.ok({ deleted: result.deleted, id: result.id })
  }

  methodNotAllowedHere() {
    return this.methodNotAllowed()
  }

  /** Probe thật (spawn tiến trình / gọi mạng) theo bản nháp — không emit domain event. */
  async testServer() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = McpServerTestSchema.safeParse(b.value)
    if (!parsed.success) return this.badRequest(firstIssue(parsed.error))

    const draft = McpRegistry.normalise(parsed.data.server)
    if (!draft) return this.badRequest('invalid mcp server config')

    // xem docs/architecture/code/mcp.md §9
    const saved = mcpRegistry.get(draft.id)
    const testWarnings: string[] = []
    const candidate = saved ? draft.restoreMasked(saved, testWarnings) : draft
    const sameTarget = Boolean(saved) && saved!.destination() === candidate.destination()
    if (!sameTarget && draft.needsStoredSecret()) {
      return this.badRequest(
        'đích kết nối đã đổi so với cấu hình đã lưu — nhập lại secret hoặc lưu cấu hình mới trước khi kiểm tra',
      )
    }
    const server = sameTarget ? candidate : draft
    try {
      server.assertEndpoint()
    } catch (err: any) {
      return this.badRequest(String(err?.message ?? err))
    }

    const result = await McpClient.probe(server, {
      listTools: parsed.data.listTools !== false,
      credentials: credentialResolver(),
    })

    if (sameTarget) {
      mcpRegistry.recordCheck(server.id, {
        at: new Date().toISOString(),
        ok: result.ok,
        toolCount: result.tools.length,
        toolNames: result.tools.map((t) => t.name),
        ...(result.error ? { error: result.error } : {}),
      })
    }

    emitAudit({
      op: 'update',
      entity: 'mcp-server',
      identifier: server.id,
      projectId: null,
      detail: { action: 'test', ok: result.ok },
    })

    return this.ok({
      ok: result.ok,
      serverInfo: result.serverInfo,
      tools: result.tools,
      warnings: [...new Set([...testWarnings, ...server.warnings(), ...result.warnings])],
      error: result.error,
      durationMs: result.durationMs,
    })
  }
}

function firstIssue(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  const issue = error.issues[0]
  if (!issue) return 'invalid mcp server config'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}
