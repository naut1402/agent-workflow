# PR todo debt — đánh dấu việc đối ứng sau

Quy ước cho nợ tài liệu / test hoãn lại (`docs/todo/`).

Commit và PR: [`git-pr.md`](git-pr.md).

---

## 1. Khi nào ghi nợ

- **Đổi convention / rule trong lúc code chưa ổn** — implement vẫn đang đổi kiến trúc; mỗi lần chỉnh rule rồi sửa lại là lãng phí. Hoãn cập nhật đến khi hành vi đã review / ổn định.
- **Hotfix / POC / ship nhanh** — cố ý tạm bỏ test hoặc bước chất lượng, nhưng vẫn phải **ghi nợ** để không mất dấu.

---

## 2. Phương châm

| Việc | Làm |
|------|-----|
| Đánh dấu nợ | Tạo `docs/todo/<issue>/<task-id>.md` (tạo cả cây `docs/todo/` khi chưa có) |
| Đất sống của file nợ | Branch / PR vào dòng version (`dev/x.y.z/main`) — **được** mang nợ trong giai đoạn version |
| Gate | PR **`dev/x.y.z/main` → `main`**: CI **chặn** nếu thư mục `docs/todo` còn tồn tại |
| Trả nợ | Trước khi promote lên `main`: làm đủ việc còn thiếu **và xoá toàn bộ** `docs/todo/` |

- **`<issue>` / `<task-id>`** là slug chữ-số/gạch ngang (vd `174`, `F0012`, `hotfix-logs`). Không có issue GitHub thì dùng id task nội bộ hoặc `adhoc`.
- **Bất biến**: trên `main` (sau merge từ dòng version), `docs/todo` **không tồn tại**.

### 2.1 Nợ test KHÔNG đi qua `docs/todo/`

Test code sống ở dòng branch riêng ([`git-pr.md`](git-pr.md) §4.3), nên nợ test có bề mặt cứng của riêng nó — **không** ghi vào `docs/todo/` nữa:

| | Nợ docs/convention | Nợ test |
|---|---|---|
| Đánh dấu bằng | file `docs/todo/<issue>/<task-id>.md` | **dòng `test/x.y.z/main` chưa tồn tại hoặc rỗng** |
| Gate | `todo-debt.yml` — kiểm thư mục có tồn tại (honor-system) | `release-test-gate.yml` — **chạy thật**: overlay dòng test, chạy full suite, gác cổng coverage |
| Nới được không | được, bằng cách trả nợ trước khi promote | **không** nới bằng sửa cấu hình cổng. Hotfix gấp thì bỏ qua bằng thao tác có dấu vết (admin merge / ghi rõ ở PR body), không bằng cách tắt gate |

- **Vì sao khác nhau** — nợ docs chỉ người đọc phát hiện được, còn nợ test thì máy chạy ra được. Cái đo được thì gác bằng cách đo, không gác bằng file đánh dấu.
- **Loại nợ `test` trong khung §3 vẫn giữ** cho trường hợp còn lại: task cố ý **miễn trừ** test (chỉ đổi tài liệu, chỉ đổi tên biến nội bộ) — ghi lý do miễn trừ để người duyệt thấy, thay vì để cổng đỏ vô cớ.

---

## 3. Nội dung file nợ

Tối thiểu phải có: **Loại nợ** (`docs-convention` | `test` | `other`), **Vì sao hoãn**, **Việc cần làm khi đối ứng** (checklist), **Liên kết** PR/branch liên quan.

**Không nhét diff dài hay secret vào file nợ.**

Khung chuẩn:

```markdown
# Todo — <task-id>

- **Issue / epic:** <n hoặc slug>
- **Loại nợ:** docs-convention | test | other
- **Branch / PR tạo nợ:** …
- **Ngày tạo:** YYYY-MM-DD

### Vì sao hoãn

…

### Việc cần làm khi đối ứng

- [ ] …
- [ ] Xoá **cả thư mục** `docs/todo/` khi không còn file nợ nào
```

---

## 4. Luồng làm việc

```text
[hotfix / POC / refactor trên dòng version]
    → tạo docs/todo/<issue>/<task-id>.md
    → merge vào dev/x.y.z/main khi còn nợ (gate Todo debt KHÔNG chạy ở đây)

[trước khi mở / merge PR promote: dev/x.y.z/main → main]
    → cập nhật rule trong docs/agent-rules/ (nếu nợ convention)
    → bổ sung test (nếu nợ test)
    → xoá hết docs/todo/ (cả thư mục)
    → CI Todo debt xanh → mới merge được lên main
```

Theo dõi nợ dài hạn ngoài gate này thì dùng GitHub Issue.

---

## 5. CI

- **Script gate**: `.github/scripts/check-todo-debt.ts`; workflow `.github/workflows/todo-debt.yml`.
- **Chỉ chạy khi** `pull_request` có **base** = `main` và **head** khớp `dev/<…>/main`.
- **`bun run check:todo`** fail nếu `docs/todo` còn tồn tại.
- **Nợ test có gate riêng** — `.github/workflows/release-test-gate.yml`, cùng loại PR, nhưng chặn bằng cách chạy thật (§2.1). `todo-debt.yml` **không** gánh việc đó.

---

## 6. Checklist nhanh

- [ ] Có hoãn docs/convention? → đã có `docs/todo/<issue>/<task-id>.md`
- [ ] PR feature → `dev/x.y.z/main`? → được mang nợ; Todo debt **không** chặn
- [ ] PR `dev/x.y.z/main` → `main`? → **không còn** thư mục `docs/todo/`; `bun run check:todo` xanh
- [ ] Đã trả nợ? → đã xoá toàn bộ `docs/todo/`
- [ ] Nợ **test**? → không ghi vào `docs/todo/`; dòng `test/x.y.z/main` phải tồn tại và xanh trước khi promote (§2.1)
