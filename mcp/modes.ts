export const MCP_MODES = ['readonly', 'full'] as const
export type McpMode = (typeof MCP_MODES)[number]

export const DEFAULT_MODE: McpMode = 'readonly'

export const MODE_ENV_VAR = 'DEVTEAM_MCP_MODE'

export const READ_TOOLS = [
  'list_projects',
  'get_project',
  'get_knowledge_bundle',
  'list_tasks',
  'get_task_state',
  'get_task_context',
  'list_artifacts',
  'read_artifact',
] as const

export const WRITE_TOOLS = ['add_project', 'create_qa', 'remove_project'] as const

export const TOOL_ALLOWLIST: Record<McpMode, readonly string[]> = {
  readonly: READ_TOOLS,
  full: [...READ_TOOLS, ...WRITE_TOOLS],
}

export function isToolEnabled(mode: McpMode, tool: string): boolean {
  const allowed = TOOL_ALLOWLIST[mode]
  return allowed ? allowed.includes(tool) : false
}

export function isMcpMode(value: unknown): value is McpMode {
  return typeof value === 'string' && (MCP_MODES as readonly string[]).includes(value)
}

export function parseModeArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--mode=')) return arg.slice('--mode='.length)
    if (arg === '--mode') return argv[i + 1] ?? ''
  }
  return null
}

export function resolveMode(opts: {
  argv?: readonly string[]
  env?: Record<string, string | undefined>
  warn?: (msg: string) => void
} = {}): McpMode {
  const argv = opts.argv ?? process.argv.slice(2)
  const env = opts.env ?? process.env
  const warn = opts.warn ?? ((msg: string) => void process.stderr.write(`${msg}\n`))

  const raw = parseModeArg(argv) ?? env[MODE_ENV_VAR] ?? null
  if (raw === null) return DEFAULT_MODE
  if (isMcpMode(raw)) return raw

  warn(
    `[dev-team-dashboard mcp] unknown mode ${JSON.stringify(raw)} — expected one of `
      + `${MCP_MODES.join(', ')}; falling back to ${DEFAULT_MODE}`,
  )
  return DEFAULT_MODE
}
