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
