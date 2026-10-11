/**
 * Hợp đồng thực thi một action của automation rule theo `kind`.
 *
 * `runAction.ts` chỉ biết interface này: tra executor theo `kind` ở
 * `actionExecutors.ts`, thay biến `{{…}}` trên `substFields`, ghi `buildInput`
 * vào step, rồi `execute`. Có `jobId` thì chuỗi chờ job tới trạng thái
 * terminal; không có thì `stdout` là kết quả đồng bộ.
 */

import type { AutomationAction, AutomationActionKind } from '../../schemas/automation.js'
import type { AutomationRunnerInput } from '../AutomationRunner.js'

/**
 * Action của đúng một `kind` — thu hẹp từ discriminated union của schema
 * (`kind?:` vì `z.infer` dưới `strict: false` đánh dấu mọi field là optional).
 */
export type AutomationActionOf<K extends AutomationActionKind> = Extract<AutomationAction, { kind?: K }>

/** Trần stdout lưu vào step — job (log) lẫn kết quả đồng bộ. */
export const STEP_STDOUT_CAP = 64_000
/** Trần mỗi field text trong tóm tắt input của step. */
export const STEP_INPUT_FIELD_CAP = 4_000

export function capText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text
}

/** Ngữ cảnh một lần chạy rule mà executor cần. */
export interface ActionRunContext {
  input: AutomationRunnerInput
  runId: string
}

export interface StepExecution {
  taskId?: string
  jobId?: string
  /** Data root mà bước này thực sự chạy trên đó — đọc artifacts theo đúng project đích. */
  root?: string
  /** Có giá trị khi action không tạo job — kết quả chạy đồng bộ (httpRequest). */
  stdout?: string
  skipped?: boolean
  error?: string
}

export interface AutomationActionExecutor<K extends AutomationActionKind = AutomationActionKind> {
  readonly kind: K
  /** Field string được thay biến `{{…}}` trước khi thực thi. */
  readonly substFields: readonly string[]
  /** Tóm tắt input đã resolve biến — lưu vào step để xác nhận lại sau khi chạy. */
  buildInput(action: AutomationActionOf<K>): Record<string, unknown>
  execute(action: AutomationActionOf<K>, run: ActionRunContext): Promise<StepExecution>
}
