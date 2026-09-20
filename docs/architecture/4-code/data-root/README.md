# Data root `.dev-team-agent/` — schema chi tiết

← [`../README.md`](../README.md) (Cấp 4 · Code)

Tên file/field thật mà orchestrator (bên ngoài repo) và dashboard cùng đọc/ghi. Đọc khi cần biết chính xác 1 giá trị nằm ở file nào, hoặc thêm field mới vào state.

| Nội dung | Vị trí | Ghi chú |
|---|---|---|
| Trạng thái sống của từng task | `.dev-state/<task-id>.json` | Field: `current_phase`, `hitl_pending`, `review_round`, `doc_review_round`, … |
| Artifact từng phase | `tasks/<task-id>/*.md` | `investigate.md`, `design.md`, `phpstan.md`, `review.md`, `test-spec.md`, `pr-desc.md`, `qa.md`, sidecar `*-po.md` (doc-review) |
| Override cấu hình pipeline | `pipeline.yaml` (global), `tasks/<id>/pipeline.yaml` (per-task) | — |
| Config do dashboard quản lý | `pipeline-profiles/`, `custom-agents/`, `agent-templates/`, `workflow-step-templates/`, `flow-profiles/` | — |
| Knowledge store (driver `file`) | `knowledge.config.yaml`, `knowledge/{project,system}/*.md`, sidecar `knowledge/collections.yaml` | Scope `global` **không** nằm ở đây — ở `registryHome()/knowledge/global/`, dùng chung mọi project |
| Resolve root theo run mode (Dev / Standalone) | `src/backend/registry.ts` | Hàm `resolveProjectRoot` |
