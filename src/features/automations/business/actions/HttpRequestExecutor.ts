/**
 * Action `httpRequest`: gọi HTTP qua `fetchUrlSafe` (duy nhất nơi enforce SSRF —
 * https-only + chặn private host). Không tạo job — body response là kết quả
 * đồng bộ của bước.
 */

import { fetchUrlSafe } from '../peers.js'
import {
  capText,
  STEP_INPUT_FIELD_CAP,
  STEP_STDOUT_CAP,
  type AutomationActionExecutor,
  type AutomationActionOf,
  type StepExecution,
} from './AutomationActionExecutor.js'

type HttpRequestAction = AutomationActionOf<'httpRequest'>

export class HttpRequestExecutor implements AutomationActionExecutor<'httpRequest'> {
  readonly kind = 'httpRequest' as const
  // `headers` cố ý không thay biến.
  readonly substFields = ['name', 'description', 'url', 'body'] as const

  buildInput(action: HttpRequestAction): Record<string, unknown> {
    return {
      method: action.method,
      url: action.url,
      ...(action.headers ? { headers: action.headers } : {}),
      ...(action.body ? { body: capText(action.body, STEP_INPUT_FIELD_CAP) } : {}),
    }
  }

  async execute(action: HttpRequestAction): Promise<StepExecution> {
    try {
      const text = await fetchUrlSafe(action.url, {
        method: action.method,
        headers: action.headers,
        body: action.body,
      })
      return { stdout: capText(text, STEP_STDOUT_CAP) }
    } catch (err: any) {
      return { error: String(err?.message ?? err) }
    }
  }
}
