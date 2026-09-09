<!--
Template PR **dòng test** (`test/x.y.z/{taskID}_{slug}` → `test/x.y.z/main`).
Mở PR trên web kèm `?template=test.md` để GitHub áp đúng template.
Title theo prefix: [<TASK>] test: <desc> — commitlint chạy trên base `test/**/main`.
Quy ước dòng test: docs/agent-rules/git-pr.md §4.3 · docs/agent-rules/testing.md §3.
PR này KHÔNG sửa file nào ngoài `tests/` và `test-e2e/`.
-->

## Issue
<!-- DÙNG từ khoá KHÔNG auto-close: "Refs #<n>" / "Part of #<n>". -->
Part of #

## PR code liên quan
<!--
Link PR ở dòng dev mà PR test này phủ. Đây là nửa còn lại của liên kết hai
chiều — PR code có mục `## PR test liên quan` trỏ về đây.
-->
-

## Source ref đã overlay
<!--
Cặp ref đã dùng để chạy suite. Bắt buộc ghi SHA, không chỉ tên branch: "test
lệch pha với source" là rủi ro số 1 của mô hình tách, và SHA là thứ duy nhất
truy được sau này.
-->
`dev/x.y.z/main` @ `<SHA>`

## Phạm vi test
<!-- Theo suite/module (vd `tests/src/features/monitor/business`), KHÔNG theo path source. -->
-

## Test view point & test case
<!-- Tiếng Việt, checklist theo module/chức năng. Mỗi case: đầu vào → hành vi mong đợi. Dài thì bọc <details>. -->
<details>
<summary>Test view point & test case</summary>

- [ ] ...

</details>

## Loại test đã thêm/migrate
- [ ] Unit (bun test) ở `tests/src/server` · `tests/src/features/**/business` · `tests/mcp` · `tests/tools`
- [ ] Unit (vitest) ở `tests/src` (FE: components, composables, core, configs)
- [ ] Integration API (Hono `app.request`)
- [ ] E2E (playwright) ở `test-e2e/` — ảnh capture đính vào comment, không commit vào `docs/`

## Coverage trước → sau
<!-- Lấy từ job summary "Cổng coverage" của CI dòng test. -->
| Chỉ số | Baseline | Sau PR này |
|---|---|---|
| FE lines | | |
| BE lines | | |

## Evidence
<!-- Link Release asset `reports-<x.y.z>` do CI đẩy lên, hoặc artifact test-evidence của lượt chạy. -->
-

## Checklist
- [ ] CI `Test overlay CI` xanh (suite chạy trên cây ghép source + test)
- [ ] **Không** sửa file nào ngoài `tests/` · `test-e2e/`
- [ ] **Không** thêm `package.json` / `*.config.ts` / `tsconfig.json` vào dòng test — dependency và config runner thuộc dòng source
- [ ] Thêm/đổi thư mục test → đã khai vào `tests/runners.json` và sinh lại `tests/CATALOG.md`
- [ ] Coverage không tụt so với baseline (cổng xanh)
- [ ] Base PR là `test/x.y.z/main` (không phải `test/main`, không phải `main`)
- [ ] Gặp bug ở source → đã ghi lại và mở task ở dòng source; **không** tự sửa source trong PR này
