/**
 * Định danh của node/step điều phối — dùng ở **cả hai** tầng:
 * - backend: `metadata.stepId` của job quyết định, lọc session ledger, clear cờ
 *   halt khi người dùng chat với node;
 * - frontend: id node trên canvas monitor và canvas editor.
 *
 * Vì vậy nó nằm ở `shared/` chứ không phải trong feature: trước đây hằng này bị
 * nhân đôi (một bản ở schema backend, một bản ở `frontend/lib`) với một comment
 * "hai giá trị phải bằng nhau" mà không có gì bảo vệ điều kiện đó.
 *
 * Tiền tố `__` không đụng id step người dùng đặt — `writePipelineConfig` từ chối
 * mọi step id bắt đầu bằng `__`.
 */
export const ORCHESTRATOR_STEP_ID = '__orchestrator__'

/**
 * Dòng cuối output agent phải bắt đầu bằng chuỗi này thì mới được coi là quyết
 * định. Nằm cạnh `ORCHESTRATOR_STEP_ID` vì cùng là hằng của giao thức điều phối:
 * `orchestrator` sinh ra nó, `monitor` phải nhận ra để giấu khỏi khung chat.
 */
export const DECISION_SENTINEL = 'ORCHESTRATOR_DECISION:'

/**
 * Giao thức con → cha: tiền tố dòng cuối output của nút con.
 *
 * Nằm cạnh `DECISION_SENTINEL` ở `shared/` vì có HAI feature đọc nó:
 * `orchestrator` dựng kết quả bước, và `runner` chốt tóm tắt ngay trong `runJob`
 * (xem `stepSummaryOf`).
 */
export const STEP_SUMMARY_PREFIX = 'STEP_SUMMARY:'

/**
 * Bóc fence `` ` `` quanh MỘT dòng — chỉ khi hai đầu CÂN nhau.
 *
 * Agent CLI hay bọc dòng giao thức trong `` `…` `` hoặc ```` ```…``` ````, nên
 * phải tha. Nhưng một dòng tóm tắt kết câu bằng code span (``STEP_SUMMARY: đã
 * ghi `design.md` ``) thì backtick cuối là NỘI DUNG: bóc mù hai đầu ăn mất nó.
 * Vì vậy chỉ bóc khi số backtick mở đúng bằng số backtick đóng.
 */
export function stripBalancedFence(line: string): string {
  const trimmed = String(line ?? '').trim()
  const fenced = trimmed.match(/^(`+)([\s\S]*)\1$/)
  return (fenced ? fenced[2] : trimmed).trim()
}

/**
 * Dòng `STEP_SUMMARY:` cuối cùng CÓ nội dung — nút con có thể "nghĩ" nhiều dòng
 * trước đó. Cùng quy ước nhận dạng với `lastDecisionLine`: dòng sau khi bóc
 * fence phải BẮT ĐẦU bằng tiền tố, nên tiền tố nằm giữa câu không được tính.
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
