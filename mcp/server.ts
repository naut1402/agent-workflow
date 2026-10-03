#!/usr/bin/env bun
import { AbstractMcpServer } from './AbstractMcpServer.js'
import { DashboardMcpServer } from './DashboardMcpServer.js'

if (import.meta.main) {
  new DashboardMcpServer(AbstractMcpServer.resolveMode()).start().catch((err) => {
    console.error(`[dev-team-dashboard mcp] fatal: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
  })
}
