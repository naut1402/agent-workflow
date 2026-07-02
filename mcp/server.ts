#!/usr/bin/env bun
// MCP (Model Context Protocol) stdio server for the dev-team-dashboard project
// registry. Spawned by Claude Code (see plugins/dev-agent-teams/.mcp.json).
//
// It exposes CRUD over the SAME projects.json the REST/standalone server uses
// (via the shared server/registry.ts) — so projects added from Claude Code and
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
import { list, get, add, addFromGit, remove } from '../server/registry.js'

// Return `any` to stay decoupled from the SDK's literal content-type unions.
export function ok(payload: unknown): any {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

export function fail(message: unknown): any {
  return { isError: true, content: [{ type: 'text', text: String(message) }] }
}

export const AddProjectInput = z
  .object({
    path: z.string().optional(),
    gitUrl: z.string().optional(),
    branch: z.string().optional(),
    name: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const hasPath = Boolean(v.path?.trim())
    const hasGit = Boolean(v.gitUrl?.trim())
    if (hasPath === hasGit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one of path or gitUrl is required',
      })
    }
  })

// ── Tool handlers (exported for unit testing) ──────────────────────────────────

export function handleListProjects(): any {
  return ok(list())
}

export function handleGetProject({ id }: { id: string }): any {
  const project = get(id)
  if (!project) return fail(`unknown project: ${id}`)
  return ok({ project })
}

export async function handleAddProject(input: z.infer<typeof AddProjectInput>): Promise<any> {
  const parsed = AddProjectInput.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'invalid input')
  const body = parsed.data
  const result = body.gitUrl
    ? await addFromGit({ gitUrl: body.gitUrl, branch: body.branch, name: body.name })
    : add({ path: body.path, name: body.name })
  if ('error' in result) return fail(result.error)
  return ok({ project: result.project })
}

export function handleRemoveProject({ id }: { id: string }): any {
  const result = remove(id)
  if ('error' in result) return fail(result.error)
  return ok({ removed: true })
}

// ── Server wiring ──────────────────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'dev-team-dashboard', version: '0.1.0' })

  server.tool(
    'list_projects',
    'List all dev-team workspaces registered in the dashboard project registry.',
    {},
    async () => handleListProjects(),
  )

  server.tool(
    'get_project',
    'Get one registered project by its id.',
    { id: z.string().describe('Project id (from list_projects).') },
    async ({ id }) => handleGetProject({ id }),
  )

  server.tool(
    'add_project',
    'Register a dev-team workspace. Provide `path` (absolute path to `.dev-team-agent`) '
      + 'OR `gitUrl` (HTTPS). Idempotent.',
    {
      path: z.string().optional().describe('Absolute path to a .dev-team-agent dir or its project root.'),
      gitUrl: z.string().optional().describe('HTTPS Git URL to shallow-clone.'),
      branch: z.string().optional().describe('Git branch (default: main).'),
      name: z.string().optional().describe('Optional display name.'),
    },
    async (input) => handleAddProject(input),
  )

  server.tool(
    'remove_project',
    'Remove a project from the registry by id. Does NOT delete any files on disk. '
      + 'Refuses to remove the default project.',
    { id: z.string().describe('Project id to remove.') },
    async ({ id }) => handleRemoveProject({ id }),
  )

  return server
}

async function main() {
  const transport = new StdioServerTransport()
  await createMcpServer().connect(transport)
}

// Only start the stdio server when run directly (not when imported by tests).
if (import.meta.main) {
  main().catch((err) => {
    console.error(`[dev-team-dashboard mcp] fatal: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
  })
}
