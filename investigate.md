# Investigation: Integrate Antigravity CLI

## Mục tiêu
Tích hợp `antigravity cli` vào bộ nguồn agent cli của runner (`dev-team-dashboard`), cụ thể vào hệ thống chạy lệnh (Runner).

## Phát hiện từ mã nguồn
Hệ thống Runner cho phép cấu hình các `Provider` đại diện cho các công cụ CLI được sử dụng để gọi agent. Các providers hiện tại được đăng ký trong hệ thống thông qua `src/features/runner/business/registry.ts`. Các loại provider "agent-cli" được định nghĩa trong `src/features/runner/business/providers/agentCli.ts`.

Để tích hợp `antigravity cli`, chúng ta không cần tác động vào pipeline sự kiện lưu trữ gốc (domain events). Mọi thao tác cấu hình chạy lệnh đều xoay quanh việc thêm provider runtime.

## Các bước thực hiện dự kiến

1. **Khai báo Provider Type:**
   - Cập nhật `src/features/runner/business/providers/agentCli.ts`.
   - Thêm `'antigravity-cli'` vào danh sách `AGENT_CLI_PROVIDER_IDS`.

2. **Cài đặt Provider:**
   - Tạo file `src/features/runner/business/providers/antigravity-cli.ts`.
   - Cài đặt interface `AgentCliProvider` cho `antigravity cli` (bao gồm hàm `execute` để sinh và quản lý process bằng `spawn`, và `agentCapabilities` để khai báo capabilities).

3. **Đăng ký Provider:**
   - Cập nhật `src/features/runner/business/registry.ts`.
   - Gọi `register(createAntigravityCliProvider())` để thêm provider vào runtime registry.

## Hướng dẫn cài đặt và cấu hình Authentication trên Host
Để Runner có thể gọi được lệnh `agy` của Antigravity CLI, môi trường thực thi (máy host hoặc container) cần được cài đặt và cấp quyền đúng cách:

1. **Cài đặt gói CLI:**
   ```bash
   npm install -g @google/antigravity-cli
   ```
   *(Đảm bảo lệnh `agy` có sẵn trong biến môi trường `$PATH` của Runner).*

2. **Xác định file Auth và Mount cấu hình:**
   - CLI của Antigravity lưu trữ thông tin cấu hình và xác thực tại thư mục gốc: `~/.gemini/antigravity-cli/`.
   - Khi chạy trên host hoặc mount vào container (Docker/Pod), chúng ta cần điều chỉnh mount đúng thư mục này để CLI có thể tái sử dụng phiên đăng nhập mà không cần authenticate lại.
   - Thư mục cần mount: `$HOME/.gemini/antigravity-cli` (vào đúng `$HOME/.gemini/antigravity-cli` bên trong container của Runner).
   - *Lưu ý:* Việc mount cấu hình bao gồm file xác thực để CLI nhận diện danh tính và file `settings.json` cho các thiết lập chung.

## Kết luận về Domain Events
**Events:** không đổi — vì việc thêm Provider mới (antigravity cli) chỉ bổ sung một runtime module ở backend để chạy lệnh, không thay đổi entity nào cần phải lưu trữ thành domain event mới hay làm thay đổi lifecycle event của JobQueue (Job sinh ra event vẫn chạy bình thường). 

Việc thiết lập các cài đặt UI (nếu có) thuộc về Connections/Runners config, vốn không thuộc nhóm state events theo dõi trong `docs/event-catalog.md`.
