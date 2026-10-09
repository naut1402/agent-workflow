// xem docs/mcp/server.md §4.13, §5.2, §8.1
import { z } from 'zod'
import { OrchestratorDecisionShape } from '../../src/features/orchestrator/schemas/orchestrator.js'
import { AbstractMcpTools, type ToolDef } from '../AbstractMcpTools.js'

const DECIDE_TIMEOUT_MS = 15_000

const FALLBACK_HINT = 'Ra lệnh bằng dòng cuối output: `ORCHESTRATOR_DECISION: {"action":…}`.'

/** Tool `orchestrator_decide` — lớp vỏ `fetch` tới `POST /api/orchestrator/decide`. */
export class OrchestratorTools extends AbstractMcpTools {
  definitions(): ToolDef[] {
    return [
      {
        name: 'orchestrator_decide',
        access: 'write',
        hint:
          'ra lệnh điều phối (start/resume/summary/halt/respawn) — có hiệu lực NGAY, '
          + 'dùng thay cho việc in dòng ORCHESTRATOR_DECISION ở cuối output.',
        unavailableHint: FALLBACK_HINT,
        config: {
          title: 'Apply orchestration decision',
          description:
            'Thi hành một quyết định điều phối cho task đang chạy, có hiệu lực NGAY '
            + '(không cần chờ hết lượt). Chỉ gọi được từ phiên của node điều phối: '
            + 'task được xác định bằng token của chính lượt đó, 🚫 không truyền taskId. '
            + 'Gọi tool này xong thì KHÔNG in thêm dòng ORCHESTRATOR_DECISION nào nữa.',
          inputSchema: OrchestratorDecisionShape,
          outputSchema: { applied: z.string() },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
        handler: (args) => this.decide(args),
      },
    ]
  }

  async decide(args: unknown): Promise<any> {
    const token = process.env.DASHBOARD_ORCHESTRATOR_TOKEN
    const base = process.env.DASHBOARD_ORCHESTRATOR_BASE_URL
    if (!token || !base) {
      return this.fail(
        'internal',
        'thiếu DASHBOARD_ORCHESTRATOR_TOKEN/DASHBOARD_ORCHESTRATOR_BASE_URL — tiến trình này '
        + `không gắn với lượt điều phối nào. ${FALLBACK_HINT}`,
      )
    }

    let res: Response
    try {
      res = await fetch(new URL('/api/orchestrator/decide', base), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Dashboard-Orchestrator-Token': token,
        },
        body: JSON.stringify(args ?? {}),
        signal: AbortSignal.timeout(DECIDE_TIMEOUT_MS),
      })
    } catch (err: any) {
      return this.fail('internal', `không gọi được dashboard: ${String(err?.message ?? err)}. ${FALLBACK_HINT}`)
    }

    const payload: any = await res.json().catch(() => null)
    if (res.status === 400) return this.fail('invalid_input', payload?.error ?? 'quyết định không hợp lệ')
    if (res.status === 401) {
      return this.fail('internal', `token điều phối hết hạn hoặc không hợp lệ. ${FALLBACK_HINT}`)
    }
    if (!res.ok) return this.fail('internal', `dashboard trả ${res.status}. ${FALLBACK_HINT}`)
    return this.ok({ applied: String(payload?.applied ?? '') })
  }
}
