// Cửa duy nhất cho feature khác (`runner`) dùng lõi MCP.
// Không import ngược từ `runner` ở tầng business: credential được tiêm vào
// qua callback (`SerialiseContext.secretFor`).
//
// Chỉ mở đúng thứ đang có consumer ngoài file khai nó — `controller.ts` của
// feature này, `runner/business/providers/mcpJobConfig.ts` và
// `claude-code-cli.ts`. Module trong `business/` và component gọi thẳng file
// khai (`./types.js`, `./resolveRefs.js`, …), nên re-export thêm ở đây là
// export chết: không ai import, mà `unused-export` thì không phân biệt được
// "để dành cho phase sau" với "quên xoá". Phase sau cần gì thì mở thêm dòng đó.

export {
  MCP_MASK,
  sanitiseMcpServerId,
  maskSecretText,
  maskSecretValues,
  mergeMaskedSecrets,
} from './types.js'
export type { McpServerConfig } from './types.js'

export {
  listMcpServers,
  getMcpServer,
  upsertMcpServer,
  deleteMcpServer,
  recordCheckResult,
  normaliseMcpServer,
} from './registry.js'

export { assertMcpEndpoint } from './endpointGuard.js'
export { serialiseMcpServers } from './serialize.js'
export { probeMcpServer } from './client.js'
