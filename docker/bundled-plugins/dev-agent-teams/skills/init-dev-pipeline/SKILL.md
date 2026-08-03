---
name: init-dev-pipeline
description: Scaffold file cấu hình pipeline `pipeline.yaml` cho dev-team-orchestrator (global hoặc override theo task). Dùng khi muốn tuỳ biến thứ tự bước, agent, skill, HITL gate của pipeline thay vì dùng Default pipeline nhúng sẵn. Gõ /init-dev-pipeline.
argument-hint: "[--task=<id>] [--force]"
user-invocable: true
---

# Init Dev Pipeline Config

Sinh file `pipeline.yaml` mẫu để tuỳ biến pipeline của `dev-team-orchestrator`. Template **không nhúng trong skill này** — copy từ asset canonical (nguồn duy nhất, dùng chung với orchestrator + bootstrap của `dev-dashboard`):

- **Global**: `../dev-team-orchestrator/assets/pipeline.default.yaml` — flow 6-agent chuẩn, kèm comment.
- **Per-task override**: `../dev-team-orchestrator/assets/pipeline.task-override.example.yaml` — mẫu patch tối giản.

> Đường dẫn tương đối tính từ thư mục skill này (`skills/init-dev-pipeline/`); cả hai skill nằm chung plugin `dev-agent-teams`.

`dev-team-orchestrator` đọc config theo thứ tự **built-in default → global → per-task override** (cái sau đè cái trước, merge theo `step.id`). Skill này chỉ tạo file; orchestrator tự nạp khi chạy.

## Đầu vào

`$ARGUMENTS` = `[--task=<id>] [--force]`

- (không tham số): ghi config **global** `.dev-team-agent/pipeline.yaml`.
- `--task=<id>`: ghi **override theo task** `.dev-team-agent/tasks/<id>/pipeline.yaml`.
- `--force`: ghi đè nếu file đã tồn tại.

## Các bước

1. **Chọn template + đích** từ `$ARGUMENTS`:
   - Có `--task=<id>` → đọc `../dev-team-orchestrator/assets/pipeline.task-override.example.yaml`, `target = .dev-team-agent/tasks/<id>/pipeline.yaml`.
   - Không → đọc `../dev-team-orchestrator/assets/pipeline.default.yaml`, `target = .dev-team-agent/pipeline.yaml`.
2. Tạo thư mục cha của `target` nếu chưa có.
3. **Kiểm tra tồn tại**:
   - Nếu `target` đã tồn tại và **không** có `--force` → **không ghi đè**. Thông báo:
     `⚠️ <target> đã tồn tại. Thêm --force để ghi đè, hoặc sửa trực tiếp file.` rồi dừng.
   - Ngược lại → ghi đè/tạo mới.
4. **Copy nguyên văn** nội dung asset vừa đọc vào `target` (giữ comment để user dễ sửa).
5. Thông báo đường dẫn đã ghi và nhắc: sửa file rồi chạy `/dev-team-orchestrator <task-id>` để dùng. Nếu là global, nhắc per-task override có thể tạo bằng `/init-dev-pipeline --task=<id>`.

## Ghi chú schema

Ý nghĩa từng field (`step`, `hitl`, `rule_category`, `retry`, …) xem mục **Pipeline config → Schema** trong skill `dev-team-orchestrator`. Hai asset ở trên là ví dụ đầy đủ kèm comment giải thích.
