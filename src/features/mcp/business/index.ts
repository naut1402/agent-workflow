// Cửa duy nhất cho feature khác (`runner`) dùng lõi MCP.
// Không import ngược từ `runner` ở tầng business: credential được tiêm vào
// qua callback (`SerialiseContext.secretFor`).

export {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_TIMEOUT_MS,
  MCP_TRANSPORTS,
  MCP_DEFAULT_HTTP_PATH,
  MCP_DEFAULT_SSE_PATH,
  MCP_DEFAULT_AUTH_HEADER,
  MCP_DEFAULT_AUTH_SCHEME,
  MCP_MASK,
  isStdioServer,
  sanitiseMcpServerId,
  collectSecretValues,
  isMaskableSecret,
  maskSecretText,
  maskSecretValues,
  mergeMaskedSecrets,
  looksLikeSecretLiteral,
} from './types.js'
export type {
  McpTransport,
  McpCheckSummary,
  McpStdioServer,
  McpRemoteServer,
  McpServerConfig,
} from './types.js'

export {
  listMcpServers,
  getMcpServer,
  upsertMcpServer,
  deleteMcpServer,
  recordCheckResult,
  normaliseMcpServer,
} from './registry.js'

export { assertMcpEndpoint, isAllowedMcpHost } from './endpointGuard.js'
export { resolveEnvRefs, resolveHeaders } from './resolveRefs.js'
export type { ResolveEnvResult } from './resolveRefs.js'
export { serialiseMcpServers } from './serialize.js'
export type { SerialiseContext, SerialiseResult } from './serialize.js'
export { probeMcpServer } from './client.js'
export type { McpProbeResult, McpProbeOptions, McpProbeTool } from './client.js'
