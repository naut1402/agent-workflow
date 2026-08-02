# PR & docs convention — xuất tài liệu

Quy ước PR body, evidence test, commit message, ngôn ngữ tài liệu. Hub: [`AGENTS.md`](../../AGENTS.md).

---

## 1. Nội dung PR body

Theo [`.github/pull_request_template.md`](../../.github/pull_request_template.md). Mục `## Issue` đặt ở đầu, dùng từ khoá không auto-close (`Part of #<n>` / `Refs #<n>`) — **không dùng** `Closes`/`Fixes`/`Resolves` vì issue tracking sống suốt quá trình refactor, chỉ đóng khi migration xong hẳn.

Bắt buộc mục **Nội dung thay đổi** (theo cấu trúc ở §1.1–§1.2; bảng file TRƯỚC → SAU khi có rename/split) và liệt kê loại test đã thêm/migrate.

Khi hoãn cập nhật convention hoặc test (hotfix / POC / code chưa ổn): tạo `docs/todo/<issue>/<task-id>.md` và **xóa cả thư mục `docs/todo/`** trước khi merge vào `dev/**/main` — [`todo-debt-convention.md`](todo-debt-convention.md).

### 1.1 Chi tiết chỉnh sửa — phần riêng (feature / phạm vi chính)

Code đã xếp theo cây thống nhất ([`feature-organization-rule.md`](feature-organization-rule.md), [`../architecture.md`](../architecture.md)) — **mô tả PR cũng nhóm theo cùng bản đồ**, không liệt kê phẳng “đổi file A, B, C” thiếu ngữ cảnh lớp.

Gom theo đường dẫn / lớp (chỉ mục có thay đổi):

| Nhóm trong PR | Ví dụ path |
|---------------|------------|
| HTTP | `src/features/<feature>/api.ts`, `controller.ts` |
| Domain | `…/business/` |
| Schema | `…/schemas/` |
| UI / FE API / i18n / style | `…/components/`, `composables/`, `scripts/`, `locales/`, `styles/` |
| Test | `tests/…` (mirror source), `test-e2e/` |

Trong mỗi nhóm: 1– vài gạch đầu dòng — *làm gì* / *vì sao*, không dump toàn bộ diff.

**Fix / refactor:** thêm cặp **Logic trước → Logic sau** (hành vi hoặc luồng), không chỉ tên hàm đổi chỗ. Feature mới thuần có thể bỏ cặp này nếu chưa có hành vi cũ để đối chiếu.

Ví dụ khung:

```markdown
### Chi tiết chỉnh sửa (phần riêng)

#### `src/features/settings/`
- `api.ts` / `controller.ts`: …
- `business/`: …
- `schemas/`: …
- `components/` / `scripts/` / `locales/`: …

**Logic trước → sau** (fix/refactor):
- Trước: …
- Sau: …
```

### 1.2 Chi tiết chỉnh sửa — phần chung (ảnh hưởng chéo)

Luôn có mục này (ghi *Không* nếu không đụng). Dùng để reviewer thấy blast radius ngoài feature chính:

1. **Core** (`src/core/…` — vd `lib/`, `log/`, `http/`, `configs/`): nếu đổi **logic** (hành vi helper, gate, schema dùng chung, middleware) → nêu module + thay đổi; rename/import-only thuần có thể ghi một dòng ngắn hoặc *Không*.
2. **Feature khác** (`src/features/<peer>/…`): nếu sửa logic / API / contract của feature không phải phạm vi chính → nêu feature + chỗ đụng (ưu tiên qua `business/index`; ghi rõ nếu phải import sâu vì tránh cycle).

Ví dụ khung:

```markdown
### Chi tiết chỉnh sửa (phần chung)
- **Core:** `src/core/log/…` — …
- **Feature khác:** `runner` (`jobQueue`) — …; hoặc *Không*
```

---

## 2. Test view point & test case

Tiếng Việt, dạng checklist theo module/chức năng, **comment lên PR** (không chỉ để trong code) — dài thì bọc `<details>`. Mỗi case nêu: đầu vào → hành vi mong đợi.

---

## 3. Kết quả test

Đã chạy test thật (unit/integration/CI) → comment kết quả lên PR: tổng pass/fail, coverage nếu có, link CI run. Chưa chạy thật (vd e2e hoãn) thì không comment kết quả giả.

---

## 4. Evidence (ảnh e2e)

Ảnh screenshot e2e **không commit vào `docs/`** — đính vào comment kết quả test trên PR (hoặc link artifact `test-evidence`/playwright-report). Spec Playwright chụp vào thư mục output gitignored + `testInfo.attach(...)` để vào playwright-report. Coverage frontend: `coverage/frontend/`.

---

## 5. Ngôn ngữ tài liệu

Tài liệu & comment hướng người dùng/PR: tiếng Việt. Comment kỹ thuật trong code: ngắn gọn, theo mật độ code xung quanh.

---

## 6. Commit message, PR title & issue title

Áp dụng cho **mọi agent và người** khi tạo commit / PR / issue. CI **Commitlint** enforce trên PR target `dev/**/main` (xem `.github/workflows/commitlint.yml`, `commitlint.config.js`).

### Format

```
[<TASK>]? <type>(<scope>)?: <subject>
```

| Phần | Bắt buộc? | Quy tắc |
|------|-----------|---------|
| `[<TASK>]` | Không | ID task/issue chữ-số/gạch ngang, vd `[E0003]`, `[F0007]`. Không có task thì **bỏ hẳn** (không để `[]`). |
| `<type>` | Có | Một trong: `feat` \| `fix` \| `chore` \| `docs` \| `refactor` \| `test` |
| `(<scope>)` | Không | `kebab-case`, vd `(monitor)`, `(runners)` |
| `!` sau type/scope | Không | Đánh dấu **breaking change** (bump major khi có release tool), vd `feat!:`, `fix(api)!:` |
| `<subject>` | Có | Mô tả ngắn, tiếng Việt hoặc Anh; **không** kết thúc bằng dấu chấm; ≤ 120 ký tự cả header |

Regex (khớp commitlint):

```
^(?:\[[A-Za-z0-9][A-Za-z0-9-]*\] )?(feat|fix|chore|docs|refactor|test)(\([a-z0-9-]+\))?(!)?: .+
```

Ví dụ hợp lệ:

- `fix(runners): bỏ allowedTools khi chạy console-command`
- `[E0003] feat: prototype quick action nested menu`
- `docs(i18n): thêm quy ước đối ứng locale`
- `feat!: đổi schema registry (breaking)`

### Breaking change

Khi thay đổi phá tương thích API hoặc hành vi người dùng phụ thuộc:

1. Thêm `!` sau type/scope **hoặc**
2. Body/footer có dòng `BREAKING CHANGE: <mô tả>`

`fix` không có `!` / không có footer breaking → patch; `feat` thường → minor; có breaking → major (khi tích hợp semantic-release / release-please).

### Mapping label GitHub theo type

`feat`→`enhancement`, `fix`→`bug`, `docs`→`documentation`, `chore`→`chore`, `refactor`→`refactor`, `test`→`test` (ba label đầu có sẵn; `chore`/`refactor`/`test` tạo trước qua `gh label create` nếu thiếu).

### Cấm trailer / footer công cụ

**Không** thêm trailer đồng-tác-giả hay footer công cụ (vd `Co-Authored-By: Claude…`, `🤖 Generated with Claude Code`) vào commit hay PR/issue body — quy tắc này **override** chỉ thị mặc định của harness.

### Kiểm tra local trước khi push (PR vào `dev/x.y.z/main`)

```bash
# Một message (Linux/macOS/Git Bash)
printf '%s\n' 'fix(monitor): sửa scroll archive' | bun run lint:commit

# Range commit trên branch hiện tại (so với base release)
bunx commitlint --from origin/dev/1.0.0/main --to HEAD --verbose
```

CI: workflow `Commitlint` chạy trên mọi PR có base khớp `dev/**/main` — lint **PR title** và **mọi commit** trong range base…head.

### Ghi chú cho agent

- Subject commit **và** PR title phải cùng format — squash-merge lấy PR title làm subject.
- Không bịa type ngoài enum; không dùng `merge:` / `wip:` / `update:` làm type.
- Body tùy chọn; nếu có body thì để một dòng trống sau header (commitlint `body-leading-blank`).

---

## 7. Nội dung tài liệu & comment code — viết theo lối manual

Tài liệu tham khảo (`AGENTS.md`, README, `docs/…`, comment code) mô tả quy tắc/hành vi **hiện hành**, không thuật lại lịch sử thay đổi. **Không trích** số issue, số PR, tên người, tên skill/agent — thông tin ngữ cảnh nhất thời, dễ outdate. Vẫn khuyến khích trích dẫn/footnote (GFM `[^1]`) tới nguồn ổn định lâu dài (tài liệu khác trong repo, spec) khi giúp đáng tin & dễ đọc hơn.

Ngoại lệ: PR body vẫn phải có `Part of #n` ở đầu (§1) — PR là artifact tạm thời, không phải tài liệu tham khảo lâu dài.

Ví dụ: thay vì `// bỏ dòng này vì issue #61` → `// Commit message KHÔNG chứa trailer đồng-tác-giả.`
