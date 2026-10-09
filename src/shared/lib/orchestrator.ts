/** Id của node/step điều phối (backend lẫn frontend); tiền tố `__` không trùng step id người dùng đặt. */
export const ORCHESTRATOR_STEP_ID = '__orchestrator__'

/** Tiền tố dòng cuối output agent đánh dấu một quyết định điều phối. */
export const DECISION_SENTINEL = 'ORCHESTRATOR_DECISION:'

/** Tiền tố dòng cuối output của nút con (giao thức con → cha). */
export const STEP_SUMMARY_PREFIX = 'STEP_SUMMARY:'

/** Bóc fence `` ` `` quanh một dòng, chỉ khi số backtick mở bằng số backtick đóng. */
export function stripBalancedFence(line: string): string {
  const trimmed = String(line ?? '').trim()
  const fenced = trimmed.match(/^(`+)([\s\S]*)\1$/)
  return (fenced ? fenced[2] : trimmed).trim()
}

/**
 * Nội dung dòng `STEP_SUMMARY:` cuối cùng có nội dung (tiền tố đứng đầu dòng sau khi bóc
 * fence); `null` nếu không có.
 */
export function stepSummaryOf(text: string | null | undefined): string | null {
  const lines = String(text ?? '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripBalancedFence(lines[i])
    if (!line.startsWith(STEP_SUMMARY_PREFIX)) continue
    const body = line.slice(STEP_SUMMARY_PREFIX.length).trim()
    if (body) return body
  }
  return null
}
