# Todo debt — đánh dấu việc đối ứng sau

Quy ước **hiện hành**. Hub: [`AGENTS.md`](../../AGENTS.md).

## 1. Bối cảnh

Hai tình huống hay **đốt token / lệch docs** nếu cứ sửa rule ngay:

1. **Đổi convention / rule trong lúc code chưa ổn** — implement vẫn đang đổi kiến trúc; mỗi lần chỉnh `docs/implement/*` rồi sửa lại = lãng phí. Nên **hoãn** cập nhật manual đến khi hành vi đã review / ổn định.
2. **Hotfix / POC / ship nhanh** — cố ý tạm bỏ test hoặc bước chất lượng; vẫn cần **ghi nợ** để đối ứng sau, không để mất dấu.

## 2. Phương châm

| Việc | Làm |
|------|-----|
| Đánh dấu nợ | Tạo `docs/todo/<issue>/<task-id>.md` (tạo cả cây `docs/todo/` khi chưa có) |
| Đất sống của file nợ | Branch / PR vào dòng version (`dev/x.y.z/main`) — **được** mang nợ trong giai version |
| Gate | PR **`dev/x.y.z/main` → `main`**: CI **chặn** nếu thư mục `docs/todo` **còn tồn tại** |
| Trả nợ | Trước khi promote lên `main`: làm đủ việc còn thiếu **và xóa toàn bộ** `docs/todo/` |

`<issue>` / `<task-id>`: slug chữ-số/gạch ngang (vd `174`, `F0012`, `hotfix-logs`). Không có issue GitHub thì dùng id task nội bộ hoặc `adhoc`.

**Bắt buộc:** trên `main` (sau merge từ dòng version), **`docs/todo` không tồn tại**.

## 3. Nội dung file nợ

Dùng khung trong [`todo-debt-template.md`](todo-debt-template.md). Tối thiểu:

- **Loại nợ:** `docs-convention` | `test` | `other`
- **Vì sao hoãn**
- **Việc cần làm khi đối ứng** (checklist)
- **Liên kết** PR/branch liên quan (nếu có)

Không nhét diff dài hay secret vào file nợ.

## 4. Luồng làm việc

```text
[hotfix / POC / refactor trên dòng version]
    → tạo docs/todo/<issue>/<task-id>.md
    → được merge vào dev/x.y.z/main khi còn nợ (gate Todo debt KHÔNG chạy ở đây)

[trước khi mở / merge PR promote: dev/x.y.z/main → main]
    → cập nhật docs/implement (nếu nợ convention)
    → bổ sung test (nếu nợ test)
    → xóa hết docs/todo/ (cả thư mục)
    → CI Todo debt xanh → mới merge được lên main
```

Theo dõi nợ dài hạn ngoài gate này → GitHub Issue.

## 5. CI

Script gate: [`.github/scripts/check-todo-debt.ts`](../../.github/scripts/check-todo-debt.ts).

Workflow [`.github/workflows/todo-debt.yml`](../../.github/workflows/todo-debt.yml):

- `pull_request` **base** = `main`
- Job chỉ chạy khi **head** khớp `dev/<…>/main` (vd `dev/1.0.0/main`)
- `bun run check:todo` → fail nếu `docs/todo` còn tồn tại

```bash
bun run check:todo
```

## 6. Checklist nhanh

- [ ] Có hoãn docs/test? → đã có `docs/todo/<issue>/<task-id>.md`
- [ ] PR feature → `dev/x.y.z/main`? → được mang nợ; Todo debt **không** chặn
- [ ] PR `dev/x.y.z/main` → `main`? → **không còn** thư mục `docs/todo/`; `bun run check:todo` xanh
- [ ] Đã trả nợ? → đã xóa toàn bộ `docs/todo/`
