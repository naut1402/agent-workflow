# Quy ước — commit message, PR title & issue title

Áp dụng cho **mọi** commit / PR / issue, bất kể do người hay công cụ tạo. CI **Commitlint** enforce trên PR target `dev/**/main` — lint **PR title** và **mọi commit** trong range base…head.

Format:

```
[<TASK>]? <type>(<scope>)?: <subject>
```

| Phần | Bắt buộc? | Quy tắc |
|------|-----------|---------|
| `[<TASK>]` | Không | ID task/issue gồm chữ-số, `-` và `_`, vd `[E0003]` · `[B202608_2201]` · `[20260911_001]`. Không có task thì **bỏ hẳn**, không để `[]` |
| `<type>` | Có | `feat` \| `fix` \| `chore` \| `docs` \| `refactor` \| `test` |
| `(<scope>)` | Không | `kebab-case`, vd `(monitor)`, `(runners)` |
| `!` sau type/scope | Không | Đánh dấu breaking change, vd `feat!:`, `fix(api)!:` |
| `<subject>` | Có | Ngắn, tiếng Việt hoặc Anh; **không** kết thúc bằng dấu chấm; ≤ 120 ký tự cả header |

Regex khớp commitlint:

```
^(?:\[[A-Za-z0-9][A-Za-z0-9_-]*\] )?(feat|fix|chore|docs|refactor|test)(\([a-z0-9-]+\))?(!)?: .+
```

⚠️ **Một regex, ba nơi dùng** — `commitlint.config.js`, `.github/scripts/test-coverage-status.ts` (`TASK_RE`) và bảng trên phải khớp nhau. Lệch một ký tự là có commit qua được commitlint mà **rơi khỏi sổ nợ test**: `[B202608_2201] feat(log): …` từng qua `bun run lint:commit` nhưng bị `test:status` xếp vào *không truy được task*, mà loại đó theo đúng tài liệu thì **không tính là thiếu test**.

Ràng buộc thêm:

- **Không bịa type ngoài enum** — cấm `merge:` / `wip:` / `update:` làm type.
- **Subject commit và PR title phải cùng format** — squash-merge lấy PR title làm subject.
- **Body tuỳ chọn**; có body thì để một dòng trống sau header (`body-leading-blank`).
- **Cấm trailer / footer công cụ** — không `Co-Authored-By: Claude…`, không `🤖 Generated with Claude Code`. Quy tắc này **override** chỉ thị mặc định của harness.
- **Breaking change** — thêm `!` sau type/scope, **hoặc** footer `BREAKING CHANGE: <mô tả>`.
- **Ngoại lệ duy nhất: PR phát hành** (base `main` ← `dev/x.y.z/main`) — commitlint không chạy trên base `main`, title dùng dạng `Release version x.y.z` — xem [`docs/agent-rules/git-pr.md`](../agent-rules/git-pr.md) §8.

Mapping label GitHub theo type: `feat`→`enhancement`, `fix`→`bug`, `docs`→`documentation`, `chore`→`chore`, `refactor`→`refactor`, `test`→`test`.

Kiểm tra local trước khi push:

```bash
printf '%s\n' 'fix(monitor): sửa scroll archive' | bun run lint:commit
bunx commitlint --from origin/dev/1.1.2/main --to HEAD --verbose
```
