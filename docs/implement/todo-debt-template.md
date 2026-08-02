# Template — file nợ `docs/todo/<issue>/<task-id>.md`

Copy thành `docs/todo/<issue>/<task-id>.md` trên branch đang nợ (tạo cây `docs/todo/` nếu chưa có). Khi trả nợ xong: **xóa cả thư mục `docs/todo/`** — không để lại README hay folder rỗng.

```markdown
# Todo — <task-id>

- **Issue / epic:** <n hoặc slug>
- **Loại nợ:** docs-convention | test | other
- **Branch / PR tạo nợ:** …
- **Ngày tạo:** YYYY-MM-DD

## Vì sao hoãn

…

## Việc cần làm khi đối ứng

- [ ] …
- [ ] Xóa **cả thư mục** `docs/todo/` khi không còn file nợ nào (bắt buộc trước merge version main)

## Ghi chú

…
```
