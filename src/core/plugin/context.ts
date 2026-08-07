/**
 * Plugin / agent context bag — injected before Agent CLI prompt build.
 */

export interface PluginContextBag {
  projectId?: string
  projectRoot?: string
  /** `.dev-team-agent` root */
  devTeamRoot?: string
  taskId?: string
  stepId?: string
  sessionId?: string | null
  knowledgeIds?: string[]
  /** Pre-loaded knowledge markdown (id → body). */
  knowledgeBundle?: Record<string, string>
  /** Extra sections plugins may append. */
  extras?: Record<string, string>
  branch?: string
}

export type ContextContributor = (ctx: PluginContextBag) => PluginContextBag | Promise<PluginContextBag>

const contributors: ContextContributor[] = []

export function registerContextContributor(fn: ContextContributor): () => void {
  contributors.push(fn)
  return () => {
    const i = contributors.indexOf(fn)
    if (i >= 0) contributors.splice(i, 1)
  }
}

export function _resetContributorsForTest(): void {
  contributors.length = 0
}

/** Run registered contributors then return the final bag. */
export async function buildPluginContext(seed: PluginContextBag): Promise<PluginContextBag> {
  let ctx: PluginContextBag = {
    ...seed,
    knowledgeIds: [...(seed.knowledgeIds || [])],
    extras: { ...(seed.extras || {}) },
  }
  for (const fn of contributors) {
    ctx = await fn(ctx)
  }
  return ctx
}

/** Format knowledge + extras for injection into the user/system prompt. */
export function formatContextForPrompt(ctx: PluginContextBag): string {
  const parts: string[] = []
  if (ctx.branch) parts.push(`## Working branch\n\n\`${ctx.branch}\``)
  const bundle = ctx.knowledgeBundle || {}
  const ids = Object.keys(bundle)
  if (ids.length) {
    parts.push('## Knowledge\n')
    for (const id of ids) {
      parts.push(`### ${id}\n\n${bundle[id]}\n`)
    }
  }
  for (const [k, v] of Object.entries(ctx.extras || {})) {
    if (v?.trim()) parts.push(`## ${k}\n\n${v}\n`)
  }
  return parts.join('\n').trim()
}

export function mergePromptWithContext(userPrompt: string, ctx: PluginContextBag): string {
  const block = formatContextForPrompt(ctx)
  if (!block) return userPrompt
  return `${block}\n\n---\n\n${userPrompt}`
}
