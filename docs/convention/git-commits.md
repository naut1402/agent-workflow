# Quy ước — tách commit theo xử lý

Một commit ≈ một concern.

## Khi nào tách

- **Nhiều loại thay đổi cùng lúc** — `feat` / `fix` / `refactor` / `docs` / `test` / `chore`, mỗi loại (hoặc mỗi vertical slice) một commit.
- **Cùng loại nhưng độc lập về phạm vi** — vd sửa Docker script vs CRUD connection vs rule git.
- **Hotfix nhỏ trên cùng branch với refactor lớn** — tách để cherry-pick / revert riêng được.

## Quy tắc

1. **Một commit ≈ một concern** — mô tả được bằng một câu subject.
2. **Không trộn** refactor lớn với fix hành vi, hoặc docs quy ước với code feature — trừ khi không tách được an toàn (migration atomic).
3. **Thứ tự hợp lý** — nền (refactor/chore) → feat/fix → docs/test bổ sung.
4. **Stage chọn lọc theo path** (`git add <path>`), không `git add -A` khi working tree còn file ngoài concern hiện tại.
5. **Subject nêu *vì sao / xử lý nào***, không liệt kê hết file.
6. **Tách ngay lúc commit**, không dồn lại rồi chia khi mở PR.
7. **Test luôn là commit `test:` riêng** — không bao giờ dính trong commit `feat`/`fix`. Trong giai đoạn `tests/` còn nằm trên dòng source, đây là điều kiện để cherry-pick phần test sang dòng test mà không kéo theo code — xem [`docs/agent-rules/git-pr.md`](../agent-rules/git-pr.md) §4.3.

| Tách tốt | Tránh |
|----------|--------|
| `chore(docker): thêm bun script compose` rồi `feat(runner): sửa/xoá connection` | Một commit "cập nhật 1.0.2" gồm Docker + runner + docs |
| `docs(git): quy ước tách commit theo xử lý` riêng | Nhét rule docs vào commit feature không liên quan |
| `refactor(runner): …` rồi `fix(runner): …` | Refactor + đổi hành vi user trong cùng commit |

Quy ước format message: [`docs/convention/commit-message.md`](commit-message.md).
