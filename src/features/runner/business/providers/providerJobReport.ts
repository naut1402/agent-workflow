import { appendTextFileSync, existsSync, joinPath } from '../../../../backend/lib/fileHelper.js'
import { formatJobLogFooter, type JobLogHeaderInput } from '../jobLogFormat.js'
import type { ResolvedAgent } from '../types.js'
import type { ExecuteResult } from './RunnerProvider.js'

function metaStringOrUndefined(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key]
  return typeof value === 'string' ? value : undefined
}

/** Các trường header lấy thẳng từ `metadata` của job — `stepId` ưu tiên hơn `pipelineStepId`. */
export function jobLogHeaderMeta(
  meta: Record<string, unknown>,
): Pick<JobLogHeaderInput, 'runnerId' | 'connectionId' | 'projectId' | 'taskId' | 'stepId'> {
  return {
    runnerId: metaStringOrUndefined(meta, 'runnerId'),
    connectionId: metaStringOrUndefined(meta, 'connectionId'),
    projectId: metaStringOrUndefined(meta, 'projectId'),
    taskId: metaStringOrUndefined(meta, 'taskId'),
    stepId: metaStringOrUndefined(meta, 'stepId') ?? metaStringOrUndefined(meta, 'pipelineStepId'),
  }
}

/** Nhãn agent trong dòng `Agent:` của payload. */
export function agentLabelOf(agent: ResolvedAgent): string {
  if (!agent.ref) return `${agent.name || 'ad-hoc'} — không gắn agent, chạy prompt trực tiếp`
  return `${agent.ref}${agent.name ? ` (${agent.name})` : ''}`
}

/** Footer kết quả ghi sau khi job xong — phần "chuyện gì đã xảy ra". */
export function describeExecuteResult(result: ExecuteResult): string {
  return formatJobLogFooter({
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    sessionId: result.sessionId,
    error: result.error,
    artifactsFound: result.artifactsFound,
    tokenUsage: result.tokenUsage,
  })
}

/**
 * Hàm ghi thêm vào log job; `logPath` trống ⇒ no-op, lỗi ghi bị nuốt. `transform`
 * (vd mask secret) chạy trên từng đoạn ngay trước khi ghi.
 */
export function createJobLogAppender(
  logPath: string | undefined,
  transform: (text: string) => string = (text) => text,
): (text: string) => void {
  return (text: string) => {
    if (!logPath) return
    try {
      appendTextFileSync(logPath, transform(text))
    } catch {
      /* ignore */
    }
  }
}

/** Các artifact khai trong `produces` đã có trong workspace — giữ thứ tự khai. */
export function collectProducedArtifacts(workspace: string, produces: string[] | undefined): string[] {
  return (produces ?? []).filter((name) => existsSync(joinPath(workspace, name)))
}
