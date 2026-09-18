import { AbstractController } from '../../backend/http/AbstractController.js'
import { emitAudit } from '../../backend/log/store.js'
import { emitEntity } from '../../backend/events/index.js'
import { getCredential, isDirectSecretType, resolveSecretRef } from '../runner/business/index.js'
import { McpServerTestSchema, McpServerUpsertSchema } from './schemas/mcpServer.js'
import {
  assertMcpEndpoint,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  maskSecretValues,
  mergeMaskedSecrets,
  normaliseMcpServer,
  probeMcpServer,
  recordCheckResult,
  upsertMcpServer,
  type McpServerConfig,
} from './business/index.js'

/** Secret không bao giờ rời tiến trình qua response — mọi cấu hình trả về đều mask. */
function publicView(server: McpServerConfig): McpServerConfig {
  return maskSecretValues(server)
}

export class McpController extends AbstractController {
  listServers() {
    return this.ok({ servers: listMcpServers().map(publicView) })
  }

  async upsertServer() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = McpServerUpsertSchema.safeParse(b.value?.server ?? b.value)
    if (!parsed.success) return this.badRequest(firstIssue(parsed.error))

    const input = parsed.data
    if (input.transport !== 'stdio') {
      try {
        assertMcpEndpoint(input.url)
      } catch (err: any) {
        return this.badRequest(String(err?.message ?? err))
      }
    }

    const result = upsertMcpServer(input)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })

    emitAudit({ op: 'update', entity: 'mcp-server', identifier: result.server.id, projectId: null })
    emitEntity('updated', 'mcp-server', { id: result.server.id, projectId: null })
    return this.ok({ saved: true, server: publicView(result.server) })
  }

  deleteServer() {
    const result = deleteMcpServer(this.c.req.query('id') || '')
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    // `result.id` đã sanitise — audit phải ghi đúng thứ bị xoá, không phải chuỗi thô.
    if (result.deleted) {
      emitAudit({ op: 'delete', entity: 'mcp-server', identifier: result.id, projectId: null })
      emitEntity('deleted', 'mcp-server', { id: result.id, projectId: null })
    }
    return this.ok({ deleted: result.deleted, id: result.id })
  }

  methodNotAllowedHere() {
    return this.methodNotAllowed()
  }

  /**
   * Gọi mạng / spawn tiến trình thật, nên chỉ chạy khi người dùng bấm nút.
   * Không emit domain event: đây là phép đo, không đổi trạng thái nghiệp vụ.
   */
  async testServer() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = McpServerTestSchema.safeParse(b.value)
    if (!parsed.success) return this.badRequest(firstIssue(parsed.error))

    const draft = normaliseMcpServer(parsed.data.server)
    if (!draft) return this.badRequest('invalid mcp server config')
    // Bản nháp từ dialog mang `***` ở các ô người dùng không sửa — probe bằng
    // `***` thì server từ xa trả 401 và người dùng tưởng cấu hình sai.
    const server = mergeMaskedSecrets(draft, getMcpServer(draft.id))
    if (server.transport !== 'stdio') {
      try {
        assertMcpEndpoint(server.url)
      } catch (err: any) {
        return this.badRequest(String(err?.message ?? err))
      }
    }

    const secret = server.transport === 'stdio' ? null : resolveCredentialSecret(server.credentialId)
    const result = await probeMcpServer(server, {
      listTools: parsed.data.listTools !== false,
      secret,
    })

    recordCheckResult(server.id, {
      at: new Date().toISOString(),
      ok: result.ok,
      toolCount: result.tools.length,
      toolNames: result.tools.map((t) => t.name),
      ...(result.error ? { error: result.error } : {}),
    })

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
      warnings: result.warnings,
      error: result.error,
      durationMs: result.durationMs,
    })
  }
}

function resolveCredentialSecret(credentialId: string | null | undefined): string | null {
  if (!credentialId) return null
  const resolved = resolveSecretRef(getCredential(credentialId))
  if (!isDirectSecretType(resolved.type)) return null
  return (resolved as { value?: string | null }).value ?? null
}

function firstIssue(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  const issue = error.issues[0]
  if (!issue) return 'invalid mcp server config'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}
