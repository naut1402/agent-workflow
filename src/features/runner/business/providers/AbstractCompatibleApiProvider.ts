import type { McpJobDelivery } from '../mcpDelivery/McpJobDelivery.js'
import type { McpBridgeTool, McpToolBridge } from '../mcpDelivery/ToolBridgeMcpDelivery.js'
import { AgenticApiProvider, type AgenticRunContext } from './AgenticApiProvider.js'
import * as workspaceTools from './agenticWorkspaceTools.js'

/** Nhãn + gợi ý UI của một endpoint — có thì provider vào catalog. */
export interface CompatibleApiProviderUi {
  label: string
  modelHint?: string
  secretEnvHint?: string
}

/** Tool của một lượt chạy: tool workspace theo định dạng SDK + tool MCP, cùng system prompt. */
export interface CompatibleApiToolset<T> {
  baseTools: T[]
  /** Rỗng khi job không có bridge MCP. */
  bridgeTools: McpBridgeTool[]
  system: string
}

/** Lớp chung cho provider gọi một endpoint "tương thích" qua SDK riêng — hiện thực chỉ còn client, định dạng tool, vòng hội thoại. */
export abstract class AbstractCompatibleApiProvider extends AgenticApiProvider {
  readonly providerId: string
  protected readonly defaultBaseURL: string

  /** @param ui nhãn + gợi ý UI của endpoint — có thì provider vào catalog. */
  constructor(
    providerId: string,
    defaultBaseURL: string,
    mcpDelivery?: McpJobDelivery<McpToolBridge>,
    ui?: CompatibleApiProviderUi,
  ) {
    super(mcpDelivery)
    this.providerId = providerId
    this.defaultBaseURL = defaultBaseURL
    if (ui) {
      this.catalog = {
        kind: 'ai-provider',
        label: ui.label,
        modelListing: 'api',
        defaultBaseURL,
        ...(ui.modelHint ? { modelHint: ui.modelHint } : {}),
        ...(ui.secretEnvHint ? { secretEnvHint: ui.secretEnvHint } : {}),
      }
    }
  }

  /** Id model từ một trang `models.list()` của SDK (async-iterable), đã sắp xếp. */
  protected async sortedModelIds(page: AsyncIterable<{ id: string }>): Promise<string[]> {
    const ids: string[] = []
    for await (const m of page) ids.push(m.id)
    return ids.sort()
  }

  /** Timeout của request model: job → Connection → 10 phút. */
  protected requestTimeoutMs(ctx: AgenticRunContext): number {
    return Number(ctx.req.timeoutMs) || Number(ctx.runnerConfig.timeoutMs) || 600_000
  }

  /** Dựng tool workspace + tool MCP của job và system prompt, báo system prompt qua `ctx.handlers.onSystemPrompt`. */
  protected prepareToolset<T>(
    ctx: AgenticRunContext,
    buildTools: (extraTools: workspaceTools.ExtraTool[], webSearchConfigured: boolean) => T[],
    toolName: (tool: T) => string,
  ): CompatibleApiToolset<T> {
    const extraTools = workspaceTools.resolveExtraTools(ctx.runnerConfig)
    const baseTools = buildTools(extraTools, workspaceTools.isWebSearchConfigured())
    const bridgeTools = ctx.mcpBridge?.tools ?? []
    const system = [
      workspaceTools.buildToolUsagePreamble(baseTools.map(toolName), bridgeTools),
      workspaceTools.buildProjectContextPreamble(ctx.req),
      ctx.req.resolvedAgent.systemPrompt || '',
    ]
      .filter(Boolean)
      .join('\n\n')
    ctx.handlers.onSystemPrompt(system)
    return { baseTools, bridgeTools, system }
  }
}
