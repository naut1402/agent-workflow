# Refactor Workflow — Quy trình per-module

Branch chung của toàn bộ refactor: **`refactor/main`** (đã tách từ `main`).
Branch setup môi trường: **`refactor/setup-environment`** (tách từ `refactor/main`).

## Trình tự cho MỖI module cần refactor

1. **Checkout** `refactor/{module-name}/main` (tách từ `refactor/main`).
2. **Migrate code** theo plan & cấu trúc đã thống nhất (xem `coding-conventions.md` + cấu trúc module bên dưới).
3. **Commit & push**.
4. **Tạo PR** (dùng `.github/pull_request_template.md`). PR body:
   - **Mở đầu bằng mục `## Issue`** liên kết issue tracking chung bằng từ khoá **không auto-close** (`Part of #<n>` / `Refs #<n>`) — **merge PR KHÔNG đóng issue** (xem `doc-output.md`).
   - Nêu rõ **Nội dung thay đổi**: tóm tắt các file TRƯỚC và SAU khi thay đổi.
5. **Tạo test view point & test case**.
6. **Comment test view point & test case lên GitHub PR** (bọc trong `<details>` nếu quá dài).
7. **Viết unit test + e2e test theo module**:
   - Code đã có test → **migrate** test đó.
   - E2E → **chỉ chuyển đổi code, không cần xác nhận chạy** (làm sau cho đỡ tốn token).
8. **Commit & push**.
9. **Chờ CI/CD chạy và xác nhận kết quả** (job `test` phải xanh).
10. **Nếu có thực hiện test (chạy thật)** → **comment kết quả test lên PR** (số test pass/fail, coverage, link CI run). Nội dung dài → bọc trong `<details>`. *(Chỉ comment khi test được CHẠY; bước migrate-only/e2e chưa chạy thì bỏ qua.)*

## Cấu trúc module đích

**Backend `server/`**: `shared/` (fs, http, frontmatter, sanitize) ← `catalog/` `rules/` `agents/` `pipeline/` `tasks/` `registry/` `knowledge/` ← `http/` (Hono app + routes/) ← adapters (`vite`, `node`). Phụ thuộc chỉ đi xuống.

**Type dùng chung gốc `shared/`**: `schemas/` (zod → z.infer) + `agentMarkdown.ts`.

**Frontend `src/`**: feature-module theo 4 mode — `features/{monitor,pipeline-editor,agent-editor,knowledge}/{components,composables,*.api.ts}` + `shared/{ui,composables,lib}`.

## Lộ trình phase (toàn cục)
- Phase 0: lưới an toàn (characterization/golden test) + CI — **đã dựng ở setup-environment**.
- Phase 1: Bun + tsconfig allowJs, zero behavior change — **đã dựng ở setup-environment**.
- Phase 2: module hóa `server/` + `shared/` dưới màu xanh.
- Phase 3: JS→TS từng file, zod schema, chuyển HTTP sang Hono (sau khi có golden API test), bật `strict` dần.
- Phase 4: tái cấu trúc + migrate TS frontend, Vitest unit, nâng verify-*.mjs lên playwright.
