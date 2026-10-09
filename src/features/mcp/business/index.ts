// Cửa duy nhất cho feature khác (`runner`, `orchestrator`) và tiến trình stdio
// `mcp/` dùng lõi MCP. Không import ngược từ `runner` ở tầng business: credential
// đi qua cổng `CredentialResolver` — `runner` đăng ký hiện thực lúc nạp.
//
// ⚠️ `mcp/stdio.ts` nạp barrel này (hằng của `SelfMcpServer`) ⇒ 🚫 module nào ở
// đây được có side effect lúc nạp: timer, I/O, import `runner` đều giữ event loop
// của tiến trình stdio sống — `docs/mcp/server.md` §8.1.
//
// Chỉ mở đúng thứ đang có consumer ngoài file khai nó — `controller.ts` của
// feature này, `runner/business/{registry.ts,mcpDelivery,providers}/*`,
// `orchestrator/business/mcpRoute.ts` và `mcp/`. Module trong `business/` và
// component gọi thẳng file khai (`./McpServer.js`, `../business/SecretMasker`, …),
// nên re-export thêm ở đây là export chết: không ai import, mà `unused-export` thì
// không phân biệt được "để dành cho phase sau" với "quên xoá". Phase sau cần gì
// thì mở thêm dòng đó.

export { credentialResolver, useCredentialResolver } from './CredentialResolver.js'
export type { CredentialResolver } from './CredentialResolver.js'
export { SecretMasker } from './SecretMasker.js'
export { McpServer } from './McpServer.js'
export { RemoteMcpServer } from './RemoteMcpServer.js'
export { McpRegistry, mcpRegistry } from './McpRegistry.js'
export type { McpCliConfig, McpServerSet } from './McpServerSet.js'
export { McpClient } from './McpClient.js'
export { SelfMcpServer } from './SelfMcpServer.js'
export type { McpSession } from './McpClient.js'
