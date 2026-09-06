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

---

## 6. Checklist nhanh

- [ ] Có hoãn docs/test? → đã có `docs/todo/<issue>/<task-id>.md`
- [ ] PR feature → `dev/x.y.z/main`? → được mang nợ; Todo debt **không** chặn
- [ ] PR `dev/x.y.z/main` → `main`? → **không còn** thư mục `docs/todo/`; `bun run check:todo` xanh
- [ ] Đã trả nợ? → đã xoá toàn bộ `docs/todo/`
