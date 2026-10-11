/**
 * Chỗ lắp ráp duy nhất biết hiện thực executor theo `kind`. Thêm một loại
 * action = một file executor + một dòng ở đây; thiếu dòng thì typecheck đỏ
 * (mapped type phủ đủ `AutomationActionKind`).
 */

import type { AutomationActionKind } from '../../schemas/automation.js'
import type { AutomationActionExecutor } from './AutomationActionExecutor.js'
import { HttpRequestExecutor } from './HttpRequestExecutor.js'
import { RunCommandExecutor } from './RunCommandExecutor.js'
import { RunTaskExecutor } from './RunTaskExecutor.js'

const ACTION_EXECUTORS: { readonly [K in AutomationActionKind]: AutomationActionExecutor<K> } = {
  runTask: new RunTaskExecutor(),
  httpRequest: new HttpRequestExecutor(),
  runCommand: new RunCommandExecutor(),
}

/**
 * Executor cho `kind` của action. `kind` ngoài schema (rule không đi qua Zod)
 * rơi về `runTask` — giữ nguyên hành vi của chuỗi rẽ nhánh trước khi có registry.
 */
export function actionExecutorFor(kind: string): AutomationActionExecutor {
  const executor = Object.prototype.hasOwnProperty.call(ACTION_EXECUTORS, kind)
    ? ACTION_EXECUTORS[kind as AutomationActionKind]
    : ACTION_EXECUTORS.runTask
  return executor as AutomationActionExecutor
}
