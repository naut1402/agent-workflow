import { apiGet, apiPost, apiRequest } from '../../../frontend/http/client'
import type { McpServerConfig } from '../business/types'

export interface McpProbeResponse {
  ok: boolean
  serverInfo?: { name: string; version: string }
  tools: { name: string; description: string }[]
  warnings: string[]
  error?: string
  durationMs: number
}

export async function fetchMcpServers(): Promise<{ servers: McpServerConfig[] }> {
  return apiGet('/api/mcp-servers')
}

export async function saveMcpServer(server: unknown): Promise<{ saved: boolean; server: McpServerConfig }> {
  return apiPost('/api/mcp-servers', { server })
}

export async function deleteMcpServer(id: string) {
  return apiRequest('DELETE', '/api/mcp-servers', { query: { id } })
}

export async function testMcpServer(server: unknown, listTools: boolean): Promise<McpProbeResponse> {
  return apiPost('/api/mcp-servers/test', { server, listTools })
}
