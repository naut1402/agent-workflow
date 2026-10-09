// Cửa duy nhất cho feature khác (`runner`) dùng lõi MCP.
// Không import ngược từ `runner` ở tầng business: credential được tiêm vào
// qua `CredentialResolver`.
//
// Chỉ mở đúng thứ đang có consumer ngoài file khai nó — `controller.ts` của
// feature này và `runner/business/providers/*`. Module trong `business/` và
// component gọi thẳng file khai (`./McpServer.js`, `../business/SecretMasker`, …),
// nên re-export thêm ở đây là export chết: không ai import, mà `unused-export` thì
// không phân biệt được "để dành cho phase sau" với "quên xoá". Phase sau cần gì
// thì mở thêm dòng đó.

export type { McpServerConfig, McpStdioServer } from '../schemas/mcpServer.js'
export type { CredentialResolver } from './CredentialResolver.js'
export { SecretMasker } from './SecretMasker.js'
export { McpServer } from './McpServer.js'
export { RemoteMcpServer } from './RemoteMcpServer.js'
export { McpRegistry, mcpRegistry } from './McpRegistry.js'
export type { McpCliConfig, McpServerSet } from './McpServerSet.js'
export { McpClient } from './McpClient.js'
export type { McpSession } from './McpClient.js'
