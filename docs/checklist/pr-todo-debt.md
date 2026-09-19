# Checklist — PR todo debt

Bối cảnh: `docs/todo/<issue>/<task-id>.md` dùng để hoãn cập nhật docs/convention hoặc bỏ tạm bước chất lượng (hotfix/POC), mang nợ trong giai đoạn dòng version (`dev/x.y.z/main`). Gate CI **Todo debt** chỉ chặn đúng loại PR promote (`dev/x.y.z/main` → `main`) — PR feature bình thường không bị chặn. Nợ **test** đi đường khác (không qua `docs/todo/`), gác bằng gate `release-test-gate.yml`.

- [ ] Có hoãn docs/convention? → đã có `docs/todo/<issue>/<task-id>.md`
- [ ] PR feature → `dev/x.y.z/main`? → được mang nợ; Todo debt **không** chặn
- [ ] PR `dev/x.y.z/main` → `main`? → **không còn** thư mục `docs/todo/`; `bun run check:todo` xanh
- [ ] Đã trả nợ? → đã xoá toàn bộ `docs/todo/`
- [ ] Nợ **test**? → không ghi vào `docs/todo/`; dòng `test/x.y.z/main` phải tồn tại và xanh trước khi promote

Quy ước đầy đủ (khi nào ghi nợ, khung file nợ, luồng làm việc, CI): [`docs/agent-rules/pr-todo-debt.md`](../agent-rules/pr-todo-debt.md).
