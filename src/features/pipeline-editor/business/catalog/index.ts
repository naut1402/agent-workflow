import { dirname } from '../../../../backend/lib/fileHelper.js'
import type { CatalogAgentStore } from './CatalogAgentStore.js'
import type { CatalogContext, CatalogScanPatterns, CatalogSource, ScanResult } from './CatalogSource.js'
import { CursorSkillSource } from './sources/CursorSkillSource.js'
import { CustomAgentSource } from './sources/CustomAgentSource.js'
import { InstalledPluginSource } from './sources/InstalledPluginSource.js'
import { PatternSource } from './sources/PatternSource.js'
import { PluginCacheSource } from './sources/PluginCacheSource.js'
import { ProjectClaudeSource } from './sources/ProjectClaudeSource.js'
import { RepoPluginSource } from './sources/RepoPluginSource.js'
import { UserClaudeSource } from './sources/UserClaudeSource.js'

export type { CatalogAgentStore } from './CatalogAgentStore.js'
export type { CatalogScanPatterns } from './CatalogSource.js'

/**
 * Chỗ lắp ráp DUY NHẤT của catalog: biết mọi hiện thực `CatalogSource` và thứ tự
 * của chúng. Thứ tự là hành vi — `dedupeCatalogItems` giữ item gặp trước khi
 * trùng priority, và chuỗi resolve thử nguồn theo đúng thứ tự này
 * (`project`: convention rồi pattern · `plugin`: install rồi cache).
 */
const repoPlugins = new RepoPluginSource()
const SOURCES: readonly CatalogSource[] = [
  new InstalledPluginSource(),
  new CursorSkillSource(),
  new UserClaudeSource(),
  new CustomAgentSource(),
  new PluginCacheSource(),
  repoPlugins,
  new ProjectClaudeSource(),
  new PatternSource(),
]

function sourcesOwning(source: string): CatalogSource[] {
  return SOURCES.filter((s) => s.owns(source))
}

/** Priority of a catalog source when deduping items with the same name. */
export function sourcePriority(source: string): number {
  if (typeof source !== 'string') return 0
  return SOURCES.find((s) => s.owns(source))?.priority ?? 0
}

/** Dedupe catalog items by `name`; `sourcePriority` decides the winner on collision. */
export function dedupeCatalogItems<T extends { name: string; source: string }>(items: T[]): T[] {
  const byName = new Map<string, T>()
  for (const item of items) {
    const existing = byName.get(item.name)
    if (!existing || sourcePriority(item.source) > sourcePriority(existing.source)) {
      byName.set(item.name, item)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Fallback catalog when no skills/agents are discovered on disk.
export const BUILTIN_CATALOG = {
  skills: [
    { id: 'repo:dev-agent-teams:survey-codebase', name: 'survey-codebase', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Survey codebase, trace call chains' },
    { id: 'repo:dev-agent-teams:write-design', name: 'write-design', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write design documentation' },
    { id: 'repo:dev-agent-teams:coding-rules', name: 'coding-rules', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Apply coding conventions' },
    { id: 'repo:dev-agent-teams:run-phpstan', name: 'run-phpstan', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Run PHPStan static analysis' },
    { id: 'repo:dev-agent-teams:write-tests', name: 'write-tests', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write test specifications' },
    { id: 'repo:dev-agent-teams:create-pr', name: 'create-pr', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Create pull request' },
    { id: 'repo:dev-agent-teams:doc-review', name: 'doc-review', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review documentation quality' },
  ],
  agents: [
    { id: 'repo:dev-agent-teams:investigator', name: 'investigator', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Survey codebase, trace call chains from entry point', skills: ['survey-codebase'] },
    { id: 'repo:dev-agent-teams:designer', name: 'designer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write design documentation', skills: ['write-design'] },
    { id: 'repo:dev-agent-teams:test-designer', name: 'test-designer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write test spec from request+design before implementation', skills: ['write-tests'] },
    { id: 'repo:dev-agent-teams:implementer', name: 'implementer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Implement code changes', skills: ['coding-rules'] },
    { id: 'repo:dev-agent-teams:reviewer', name: 'reviewer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review code quality', skills: ['coding-rules'] },
    { id: 'repo:dev-agent-teams:pr-creator', name: 'pr-creator', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Create PR description, amend commit', skills: ['create-pr'] },
    { id: 'repo:dev-agent-teams:doc-reviewer', name: 'doc-reviewer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review document quality', skills: ['doc-review'] },
  ],
}

export interface Catalog {
  skills: any[]
  agents: any[]
}

function contextOf(
  root: string,
  projectRoot: string,
  agentStore: Partial<CatalogAgentStore>,
  scanPatterns: CatalogScanPatterns | null | undefined,
): CatalogContext {
  return { root, projectRoot, agentStore, scanPatterns: scanPatterns ?? null }
}

/**
 * `deps` là phần port `CatalogAgentStore` mà lời gọi có (tối thiểu
 * `scanCustomAgents`); `deps.scanPatterns` lấy từ settings và chỉ cộng thêm
 * vào các nguồn mặc định.
 */
export async function buildCatalog(
  root: string,
  deps: Pick<CatalogAgentStore, 'scanCustomAgents'> & Partial<CatalogAgentStore> & {
    scanPatterns?: CatalogScanPatterns | null
  },
): Promise<Catalog> {
  const { scanPatterns, ...agentStore } = deps
  const ctx = contextOf(root, dirname(root), agentStore, scanPatterns)

  const batches: ScanResult[] = []
  for (const source of SOURCES) batches.push(await source.scan(ctx))

  const allSkills: any[] = []
  const allAgents: any[] = []
  for (const b of batches) {
    allSkills.push(...(b.skills || []))
    allAgents.push(...(b.agents || []))
  }

  const skills = dedupeCatalogItems(allSkills)
  const agents = dedupeCatalogItems(allAgents)

  if (!skills.length && !agents.length) {
    return { skills: BUILTIN_CATALOG.skills, agents: BUILTIN_CATALOG.agents }
  }

  return { skills, agents }
}

/** Pure parser for the `<source>:<name>` id shape, shared by agents and skills. */
export function parseCatalogItemId(id: unknown): { source: string; name: string } | null {
  if (typeof id !== 'string') return null
  // `:` cuối cùng tách name; không có `:` (-1) hoặc `:` đứng đầu (0) đều không có source.
  const sep = id.lastIndexOf(':')
  return sep > 0 ? { source: id.slice(0, sep), name: id.slice(sep + 1) } : null
}

/** Chuỗi resolve: hỏi lần lượt các nguồn sở hữu `source`, nguồn đầu tiên trả path thắng. */
async function resolveThroughSources(
  source: string,
  resolve: (s: CatalogSource) => Promise<string | null> | undefined,
): Promise<string | null> {
  for (const s of sourcesOwning(source)) {
    const found = await resolve(s)
    if (found) return found
  }
  return null
}

/**
 * Path file agent của một id catalog. Không sanitise `name` — xem
 * `resolveCatalogSkillPath`; route xem agent cũng chưa vá khe này.
 */
export async function resolveCatalogAgentPath(
  projectRoot: string,
  root: string,
  id: string,
  deps: Pick<CatalogAgentStore, 'customAgentsDir'> & Partial<CatalogAgentStore> & {
    scanPatterns?: string[] | null
  },
): Promise<string | null> {
  const parsed = parseCatalogItemId(id)
  if (!parsed?.name) return null
  const { source, name } = parsed
  const { scanPatterns, ...agentStore } = deps
  const ctx = contextOf(root, projectRoot, agentStore, { agents: scanPatterns ?? undefined })
  return resolveThroughSources(source, (s) => s.resolveAgentPath?.(ctx, source, name))
}

/**
 * Mirrors `resolveCatalogAgentPath` but sanitizes `name` itself — this newer
 * route must not inherit the agent route's path-traversal gap (AGENTS.md §4).
 */
export async function resolveCatalogSkillPath(
  projectRoot: string,
  id: string,
  deps: { sanitiseName: (name: string) => string | null; scanPatterns?: string[] | null },
): Promise<string | null> {
  const parsed = parseCatalogItemId(id)
  if (!parsed?.name) return null
  const { source, name } = parsed
  if (deps.sanitiseName(name) !== name) return null
  const ctx = contextOf('', projectRoot, {}, { skills: deps.scanPatterns ?? undefined })
  return resolveThroughSources(source, (s) => s.resolveSkillPath?.(ctx, source, name))
}

/**
 * Fallback `<projectRoot>/plugins/<plugin>` cho id `repo:` mà chuỗi resolve không
 * ra — hook riêng, chỉ route xem nội dung gọi, để chuỗi resolve public giữ nguyên.
 * `name` và `pluginName` đều qua `sanitiseName`; không hợp lệ → `null` (404).
 */
export async function resolveRepoFallbackAgentPath(
  projectRoot: string,
  id: string,
  sanitiseName: (name: string) => string | null,
): Promise<string | null> {
  const parsed = parseCatalogItemId(id)
  if (!parsed) return null
  return repoPlugins.fallbackAgentPath(projectRoot, parsed.source, parsed.name, sanitiseName)
}

/** Như `resolveRepoFallbackAgentPath` cho skill — `name` và `pluginName` đều qua `sanitiseName`. */
export async function resolveRepoFallbackSkillPath(
  projectRoot: string,
  id: string,
  sanitiseName: (name: string) => string | null,
): Promise<string | null> {
  const parsed = parseCatalogItemId(id)
  if (!parsed) return null
  return repoPlugins.fallbackSkillPath(projectRoot, parsed.source, parsed.name, sanitiseName)
}
