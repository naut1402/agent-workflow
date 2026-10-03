#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DashboardMcpServer } from './DashboardMcpServer.js'

if (import.meta.main) {
  new DashboardMcpServer(DashboardMcpServer.resolveMode()).start(new StdioServerTransport()).catch((err) => {
    console.error(`[${DashboardMcpServer.SERVER_NAME} mcp] fatal: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
  })
}
