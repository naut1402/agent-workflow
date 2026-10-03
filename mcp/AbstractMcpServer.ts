import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { AbstractMcpTools, ToolAccess, ToolDef } from './AbstractMcpTools.js'

export const MCP_MODES = ['readonly', 'full'] as const
export type McpMode = (typeof MCP_MODES)[number]

export const DEFAULT_MODE: McpMode = 'readonly'

export type ModeSource = {
  argv?: readonly string[]
  env?: Record<string, string | undefined>
  warn?: (msg: string) => void
}

const MODE_ACCESS: Record<McpMode, readonly ToolAccess[]> = {
  readonly: ['read'],
  full: ['read', 'write'],
}

// xem docs/mcp/server.md §3
export abstract class AbstractMcpServer {
  static isMcpMode(value: unknown): value is McpMode {
    return typeof value === 'string' && (MCP_MODES as readonly string[]).includes(value)
  }

  static isToolEnabled(mode: McpMode, access: ToolAccess): boolean {
    const allowed = MODE_ACCESS[mode]
    return allowed ? allowed.includes(access) : false
  }

  static parseModeArg(argv: readonly string[]): string | null {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]
      if (arg.startsWith('--mode=')) return arg.slice('--mode='.length)
      if (arg === '--mode') return argv[i + 1] ?? ''
    }
    return null
  }

  static resolveMode(opts: ModeSource & { envVar: string; label: string }): McpMode {
    const argv = opts.argv ?? process.argv.slice(2)
    const env = opts.env ?? process.env
    const warn = opts.warn ?? ((msg: string) => void process.stderr.write(`${msg}\n`))

    const raw = AbstractMcpServer.parseModeArg(argv) ?? env[opts.envVar] ?? null
    if (raw === null) return DEFAULT_MODE
    if (AbstractMcpServer.isMcpMode(raw)) return raw

    warn(
      `[${opts.label} mcp] unknown mode ${JSON.stringify(raw)} — expected one of `
        + `${MCP_MODES.join(', ')}; falling back to ${DEFAULT_MODE}`,
    )
    return DEFAULT_MODE
  }

  private allDefinitions: ToolDef[] | null = null

  constructor(readonly mode: McpMode = DEFAULT_MODE) {}

  protected abstract readonly name: string
  protected abstract readonly version: string

  protected abstract toolGroups(): AbstractMcpTools[]

  protected instructionsPreamble(): string[] {
    return []
  }

  protected startupWarnings(): string[] {
    return []
  }

  protected onStart(): void {}

  private definitions(): ToolDef[] {
    this.allDefinitions ??= this.toolGroups().flatMap((group) => group.definitions())
    return this.allDefinitions
  }

  tools(): ToolDef[] {
    return this.definitions().filter((t) => AbstractMcpServer.isToolEnabled(this.mode, t.access))
  }

  hasTool(name: string): boolean {
    return this.tools().some((t) => t.name === name)
  }

  // xem docs/mcp/server.md §3.1
  instructions(): string {
    const lines = this.tools()
      .filter((t) => t.hint)
      .map((t) => `- \`${t.name}\` — ${t.hint}`)
    const unavailable = this.definitions()
      .filter((t) => t.unavailableHint && !this.hasTool(t.name))
      .map((t) => `\`${t.name}\` KHÔNG có ở mode \`${this.mode}\`. ${t.unavailableHint}`)
    return [...this.instructionsPreamble(), lines.join('\n'), ...unavailable]
      .filter((part) => part)
      .join('\n\n')
  }

  build(): McpServer {
    const server = new McpServer(
      { name: this.name, version: this.version },
      { instructions: this.instructions() },
    )
    for (const t of this.tools()) server.registerTool(t.name, t.config as any, t.handler as any)
    return server
  }

  async start(transport: Transport): Promise<void> {
    this.onStart()
    process.stderr.write(`[${this.name} mcp] mode=${this.mode} version=${this.version}\n`)
    for (const warning of this.startupWarnings()) process.stderr.write(`[${this.name} mcp] ${warning}\n`)
    await this.build().connect(transport)
  }
}
