// Frontend app version — value injected by Vite/Vitest `define` from package.json.
// Đổi version chỉ cần sửa `package.json` → `version`.
//
// ⚠️ Không gộp với `src/backend/configs/appVersion.ts`: bản đó đọc thẳng
// `package.json` (chỉ chạy được trên Bun/Node, dùng cho `mcp/server.ts`).
export const APP_VERSION: string = __APP_VERSION__
