import { RemoteMcpServer } from '../../../../../src/features/mcp/business/RemoteMcpServer.js'
import { StdioMcpServer } from '../../../../../src/features/mcp/business/StdioMcpServer.js'
import type { McpServer } from '../../../../../src/features/mcp/business/McpServer.js'
import type {
  McpRemoteServer,
  McpServerConfig,
  McpStdioServer,
} from '../../../../../src/features/mcp/schemas/mcpServer.js'

/**
 * Bọc một bản ghi thành entity mà 🚫 KHÔNG đi qua `McpRegistry.normalise` — test
 * cần quan sát đúng bản ghi nó dựng (kể cả `args: undefined`, khoá vắng), còn
 * normalise thì chuẩn hoá lại chúng.
 */
export function toMcpServer(config: McpStdioServer): StdioMcpServer
export function toMcpServer(config: McpRemoteServer): RemoteMcpServer
export function toMcpServer(config: McpServerConfig): McpServer
export function toMcpServer(config: McpServerConfig): McpServer {
  return config.transport === 'stdio' ? new StdioMcpServer(config) : new RemoteMcpServer(config)
}
