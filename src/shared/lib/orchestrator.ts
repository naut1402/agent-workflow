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
