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
    // Kiểm trên URL THÔ của payload, TRƯỚC `normalise`: `normalise` cắt khoảng
    // trắng và trả `null` cho URL rỗng/id hỏng, nên kiểm sau nó là đổi thông
    // điệp lỗi người dùng nhận (`mcp: invalid URL` thành `invalid mcp server config`).
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
    // Cảnh báo tính trên bản ĐÃ LƯU, không phải payload gửi lên: payload mang
    // `***` ở ô người dùng không sửa, nên tính trên nó là bỏ sót đúng ca
    // «secret thật vẫn đang nằm trong args».
    const warnings = [...result.warnings, ...result.server.warnings()]
    return this.ok({ saved: true, server: result.server.masked(), warnings })
  }

  deleteServer() {
    const result = mcpRegistry.delete(this.c.req.query('id') || '')
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

    const draft = McpRegistry.normalise(parsed.data.server)
    if (!draft) return this.badRequest('invalid mcp server config')

    // Bản nháp từ dialog mang `***` ở các ô người dùng không sửa — probe bằng
    // `***` thì server từ xa trả 401 và người dùng tưởng cấu hình sai. Nhưng
    // CHỈ khôi phục khi bản nháp còn trỏ đúng đích đã lưu: ghép theo mỗi `id`
    // thì đổi `url` sang host của mình rồi bấm Kiểm tra là đọc được secret mà
    // UI vẫn đang che bằng `***`. Đổi đích thì báo lỗi rõ, 🚫 không âm thầm bỏ
    // khoá (probe sẽ 401 và người dùng đi sửa nhầm chỗ).
    //
    // So trên bản ĐÃ KHÔI PHỤC (`candidate`), 🚫 không phải bản thô: ô nào mang
    // `***` thì `restoreMasked` thay bằng đúng giá trị đã lưu nên hai vế
    // khớp (E3), còn ô nào người gửi điền GIÁ TRỊ MỚI thì giá trị đó đi thẳng
    // vào `candidate` và làm đích khác đi ⇒ vẫn chặn. Khôi phục rồi mới so là
    // an toàn: nếu so ra khác thì `candidate` bị vứt, 🚫 không probe, 🚫 không
    // response nào mang nó.
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
      // Hiện thực do `runner` đăng ký lúc nạp — controller 🚫 import `runner`.
      // Chưa đăng ký ⇒ `null` ⇒ server từ xa chạy không header xác thực, kèm cảnh báo.
      credentials: credentialResolver(),
    })

    // Chỉ ghi `lastCheck` khi vừa đo đúng cấu hình đang lưu. Bản nháp (đổi url
    // rồi bấm Kiểm tra, sau đó Huỷ) mà vẫn ghi thì panel hiện một trạng thái
    // không thuộc cấu hình nào đang tồn tại.
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
      // `testWarnings` mang `argsSecretDropped`: một ô `***` neo lệch đã bị BỎ,
      // nên probe đang chạy thiếu tham số. Đánh rơi nó là người dùng nhận một
      // lỗi 🚫 không liên quan gì tới nguyên nhân thật.
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
