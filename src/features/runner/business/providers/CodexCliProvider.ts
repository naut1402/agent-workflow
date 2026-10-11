import {
  AbstractAgentCliProvider,
  type AgentCliInvocation,
  type AgentCliInvocationContext,
  type AgentCliProviderOptions,
} from './AbstractAgentCliProvider.js'
import type { ProviderCatalogInfo, TranscriptFormat } from './RunnerProvider.js'

/** Codex CLI — argv thuần `[...flags, prompt]`, không bắt session, không nhận MCP. */
export class CodexCliProvider extends AbstractAgentCliProvider {
  readonly providerId = 'codex-cli'
  readonly catalog: ProviderCatalogInfo = {
    kind: 'local-console',
    label: 'Codex CLI',
    modelListing: 'none',
    localCommand: { id: 'codex', command: 'codex', match: { base: 'codex' } },
  }
  override readonly transcriptFormat: TranscriptFormat = 'none'

  constructor(opts: AgentCliProviderOptions = {}) {
    super({ defaultCliPath: 'codex', sessionCapture: 'none' }, opts)
  }

  protected buildInvocation(ctx: AgentCliInvocationContext): AgentCliInvocation {
    return { args: [...ctx.flags, ctx.prompt] }
  }
}
