# Quy ước — nội dung PR body (PR feature)

Repo có **2 loại PR**, body khác nhau:

| Loại PR | Base ← Head | Body theo |
|---|---|---|
| Feature / fix / docs… | `dev/x.y.z/main` ← branch task | file này · `.github/pull_request_template.md` |
| Phát hành (promote) | `main` ← `dev/x.y.z/main` | [`docs/agent-rules/git-pr.md`](../agent-rules/git-pr.md) §8 · `.github/PULL_REQUEST_TEMPLATE/release.md` |

Nội dung dưới đây áp dụng cho **PR feature**, theo `.github/pull_request_template.md`.

- **Mục `## Issue` đặt ở đầu**, dùng từ khoá **không** auto-close (`Part of #<n>` / `Refs #<n>`). **Không** dùng `Closes` / `Fixes` / `Resolves`.
- **Bắt buộc mục "Nội dung thay đổi"** theo cấu trúc 2 mục dưới đây, kèm bảng file TRƯỚC → SAU khi có rename/split.
- **Liệt kê loại test đã thêm/migrate.**

## Chi tiết chỉnh sửa — phần riêng

Mô tả PR nhóm theo **cùng bản đồ thư mục của code**, không liệt kê phẳng "đổi file A, B, C":

| Nhóm trong PR | Ví dụ path |
|---------------|------------|
| HTTP | `src/features/<f>/api.ts`, `controller.ts` |
| Domain | `…/business/` |
| Schema | `…/schemas/` |
| UI / FE API / i18n / style | `…/components/`, `composables/`, `scripts/`, `locales/`, `styles/` |
| Test | `tests/…` (mirror source), `test-e2e/` |

- **Mỗi nhóm 1–vài gạch đầu dòng** — *làm gì* / *vì sao*, không dump toàn bộ diff.
- **Fix / refactor bắt buộc có cặp Logic trước → Logic sau** (hành vi hoặc luồng), không chỉ tên hàm đổi chỗ.
- **Feature mới thuần** có thể bỏ cặp này nếu chưa có hành vi cũ để đối chiếu.

## Chi tiết chỉnh sửa — phần chung

Luôn có mục này (ghi *Không* nếu không đụng) để reviewer thấy blast radius:

- **Backend / Frontend / Shared** (`src/backend/…`, `src/frontend/…`, `src/shared/…`) — đổi **logic** (hành vi helper, gate, schema dùng chung, middleware) thì nêu module + thay đổi; rename/import-only ghi một dòng ngắn hoặc *Không*.
- **Feature khác** (`src/features/<peer>/…`) — sửa logic / API / contract của feature không phải phạm vi chính thì nêu feature + chỗ đụng.

## Test view point & kết quả

- **Test view point & test case** — tiếng Việt, checklist theo module/chức năng, **comment lên PR** (không chỉ để trong code); dài thì bọc `<details>`. Mỗi case nêu: đầu vào → hành vi mong đợi.
- **Kết quả test** — đã chạy thật thì comment tổng pass/fail, coverage nếu có, link CI run. **Chưa chạy thật thì không comment kết quả giả.**
- **Evidence e2e** — ảnh screenshot **không** commit vào `docs/`; đính vào comment kết quả test hoặc link artifact `test-evidence` / playwright-report.
