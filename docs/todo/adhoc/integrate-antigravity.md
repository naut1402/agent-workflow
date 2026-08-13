# Todo — integrate-antigravity

- **Issue / epic:** adhoc
- **Loại nợ:** other
- **Branch / PR tạo nợ:** `feature/integrate-antigravity-cli` / [#210](https://github.com/naut1402/agent-workflow/pull/210)
- **Ngày tạo:** 2026-08-12
- **Ngày cập nhật:** 2026-08-13

## Vì sao hoãn

Provider `antigravity-cli` đã ship (đăng ký + session capture `antigravity-json`). Hoãn refactor để tách shared local-console provider khỏi `claude-code-cli.ts` — tránh đụng kiến trúc khi đang cần ra mắt nhanh.

## Việc cần làm khi đối ứng

- [ ] Tách `createLocalConsoleProvider` (và nhánh session JSON) ra module shared (vd `shared-cli-provider.ts`) — hiện nằm trong `claude-code-cli.ts`.
- [ ] (Tuỳ chọn) Generic hóa `SessionCaptureMode` thay vì mode vendor `antigravity-json` (field map / strategy).
- [ ] Xóa **cả thư mục** `docs/todo/` khi không còn file nợ nào (bắt buộc trước merge version → `main`).

## Đã xong trên PR #210

- [x] Đăng ký provider `antigravity-cli` (`agy`).
- [x] Session resume qua `--output-format json` → `conversation_id` → `--conversation`.
- [x] Unit test `parseAntigravityJsonOutput` / `buildAntigravityJsonInvocation` trong `sessionCapture.test.ts`.

## Ghi chú

- Auth/mount `~/.gemini/antigravity-cli` là hướng dẫn ops (host/container), không thuộc nợ code này.
