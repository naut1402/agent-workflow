// App semver — nguồn chân lý duy nhất là `package.json` → `version`.
// Đổi version ở đó; Vite (`define`) và MCP đều lấy từ `package.json` qua đây.
//
// ⚠️ Không gộp với `src/frontend/lib/appVersion.ts`: bản đó đọc `__APP_VERSION__`
// do Vite `define` bơm vào (không có `package.json` lúc chạy trên browser). Hai
// module cùng tên nhưng khác đường lấy dữ liệu — gộp là vỡ một trong hai phía.
import { version } from '../../../package.json'

export const APP_VERSION: string = version
