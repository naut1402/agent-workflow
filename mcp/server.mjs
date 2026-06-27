#!/usr/bin/env node
// MCP (Model Context Protocol) stdio server for the dev-team-dashboard project
// registry. Spawned by Claude Code (see plugins/dev-agent-teams/.mcp.json).
//
// It exposes CRUD over the SAME projects.json the REST/standalone server uses
// (via the shared server/registry.js) — so projects added from Claude Code and
// from the dashboard UI stay consistent. The MCP server operates directly on
// the registry file and does NOT require the HTTP server to be running.
//
// Tools (design §4.4):
//   list_projects  {}                     → { projects, defaultId }
//   add_project    { path, name? }         → { project } (validated)
//   remove_project { id }                  → { removed: true }
//   get_project    { id }                  → { project }
//
// Design ref: U0001 design.md §4.4.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { list, get, add, remove } from '../server/registry.js'

const server = new McpServer({
  name: 'dev-team-dashboard',
  version: '0.1.0',
})

function ok(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

function fail(message) {
  return { isError: true, content: [{ type: 'text', text: String(message) }] }
}

server.tool(
  'list_projects',
  'List all dev-team workspaces registered in the dashboard project registry.',
  {},
  async () => ok(list()),
)

server.tool(
  'get_project',
  'Get one registered project by its id.',
  { id: z.string().describe('Project id (from list_projects).') },
  async ({ id }) => {
    const project = get(id)
    if (!project) return fail(`unknown project: ${id}`)
    return ok({ project })
  },
)

server.tool(
  'add_project',
  'Register a dev-team workspace. `path` must be an absolute path to a '
    + '`.dev-team-agent` directory (or a project root containing one). Idempotent.',
  {
    path: z.string().describe('Absolute path to a .dev-team-agent dir or its project root.'),
    name: z.string().optional().describe('Optional display name (defaults to the project folder name).'),
  },
  async ({ path: inputPath, name }) => {
    const result = add({ path: inputPath, name })
    if (!result.ok) return fail(result.error)
    return ok({ project: result.project })
  },
)

server.tool(
  'remove_project',
  'Remove a project from the registry by id. Does NOT delete any files on disk. '
    + 'Refuses to remove the default project.',
  { id: z.string().describe('Project id to remove.') },
  async ({ id }) => {
    const result = remove(id)
    if (!result.ok) return fail(result.error)
    return ok({ removed: true })
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error(`[dev-team-dashboard mcp] fatal: ${err && err.stack ? err.stack : err}`)
  process.exit(1)
})
