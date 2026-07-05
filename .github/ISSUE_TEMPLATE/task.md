---
name: Task / Công việc
about: Template chung cho task phát triển (feature | fix | docs | refactor | test)
title: "[<TASK>] <type>: "
labels: []
---

<!--
Prefix title: [<TASK>] <type>: <mô tả ngắn>   (type ∈ feat|fix|chore|docs|refactor|test)
Gán label theo type: feat→enhancement · fix→bug · docs→documentation · chore→chore · refactor→refactor · test→test
Feature lớn: tạo issue + plan TRƯỚC khi code; breakdown sub-task ở mục Artifact.
-->

## Mục tiêu
<!-- Vấn đề cần giải quyết + kết quả mong đợi (1–3 câu). -->

## Scope
**IN scope:**
-

**OUT scope:**
-

## Artifact / Kế hoạch
<!-- Link investigate.md / design.md / scope.md hoặc mô tả plan. Feature lớn: liệt kê breakdown sub-task ở đây. -->
-

## Checklist
- [ ] Đã gán label theo type (feat→enhancement · fix→bug · docs→documentation · chore→chore · refactor→refactor · test→test)
- [ ] (Feature lớn) đã có issue + plan trước khi code
- [ ] Thay đổi đi qua feature branch + PR (KHÔNG commit thẳng `main`)
- [ ] PR liên kết issue bằng `Part of #<n>` (không Closes/Fixes)
