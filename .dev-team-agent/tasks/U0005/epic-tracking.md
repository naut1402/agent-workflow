# Epic tracking — U0005

## Epic

**Tiêu đề:** Tích hợp agent vào pipeline dashboard  
**GitHub issue:** [#56](https://github.com/naut1402/agent-workflow/issues/56)  
**Branch chung:** `feat/U0005/dashboard-agent-integration`  
**Base:** `origin/main`

## Sub-issue (vertical slice)

| Task ID | GitHub | Outcome | Branch | Trạng thái pipeline |
|---------|--------|---------|--------|---------------------|
| U0005-1 | [#57](https://github.com/naut1402/agent-workflow/issues/57) | HITL approve trên pipeline flow | `feat/U0005-1/hitl-task-state` | implementer |
| U0005-2 | [#58](https://github.com/naut1402/agent-workflow/issues/58) | Quick actions trên artifact viewer | `feat/U0005-2/artifact-actions` | implementer |
| U0005-3 | [#59](https://github.com/naut1402/agent-workflow/issues/59) | Build agent từ NL qua runner | `feat/U0005-3/agent-build-wizard` | implementer |
| U0005-4 | — | (Optional) Auto-advance sau approve | `feat/U0005-4/auto-advance` | chưa mở |

## Quy ước PR

- Mỗi sub-PR **target** branch epic `feat/U0005/dashboard-agent-integration` (không target `main` trực tiếp).
- PR body: `Part of #<epic-issue>` + ghi rõ sub-task id (U0005-1, …).
- Epic PR cuối: merge `feat/U0005/dashboard-agent-integration` → `main` khi U0005-1..3 done.

## Artifact tham chiếu

- Investigate: `investigate.md`
- Design + breakdown: `design.md` §7
- Scope từng sub: `tasks/U0005-{1,2,3}/scope.md`
