import { parseAgentMarkdown, compileAgentMarkdown, emptyDraft } from './agentMarkdown.js'
import {
  access,
  dirname,
  fileURLToPath,
  homeDir,
  joinPath,
  mkdir,
  readFile,
  readTextFile,
  safeReadDir,
  writeTextFile,
} from '../../../backend/lib/fileHelper.js'
import { isPrivateHostname } from '../../../backend/lib/netUtils.js'
// xem docs/architecture/code/agent-editor.md §1
import { sanitiseProfileName } from '../../pipeline-editor/business/pipeline/index.js'

/**
 * Where a custom agent lives: `project` — `<root>/custom-agents/` (`dashboard:<name>`);
 * `global` — `~/.claude/agents/` (`user:<name>`).
 */
export type AgentScope = 'project' | 'global'

export function profilesDir(root: string): string {
  return joinPath(root, 'pipeline-profiles')
}

/**
 * Tên các pipeline profile hợp lệ trong `<root>/pipeline-profiles/`, đã sắp xếp; thư mục chưa có → [].
 * xem docs/architecture/code/agent-editor.md §2
 */
export async function listPipelineProfileNames(root: string): Promise<string[]> {
  const names: string[] = []
  for (const entry of await safeReadDir(profilesDir(root))) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
    const name = entry.name.slice(0, -'.yaml'.length)
    if (!name || sanitiseProfileName(name) !== name) continue
    names.push(name)
  }
  return names.sort()
}

export function customAgentsDir(root: string): string {
  return joinPath(root, 'custom-agents')
}

/** Machine-wide agents dir — same location the `user:` catalog source/resolver read from. */
export function globalAgentsDir(): string {
  return joinPath(homeDir(), '.claude', 'agents')
}

function agentScopeDir(root: string | null, scope: AgentScope): string {
  if (scope === 'global') return globalAgentsDir()
  return customAgentsDir(root || '')
}

export function agentTemplatesDir(root: string): string {
  return joinPath(root, 'agent-templates')
}

export function workflowStepTemplatesDir(root: string): string {
  return joinPath(root, 'workflow-step-templates')
}

/** Sanitize an agent / template name (stricter charset than profile names). */
export function sanitiseAgentName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null
  if (/[\\/\0]/.test(name)) return null
  const clean = name.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return clean || null
}

/** Catalog-shaped listing of dashboard-created custom agents (for buildCatalog). */
export async function scanCustomAgents(root: string): Promise<any[]> {
  const dir = customAgentsDir(root)
  const agents: any[] = []
  for (const entry of await safeReadDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const agentName = entry.name.replace(/\.md$/, '')
    try {
      const raw = await readFile(joinPath(dir, entry.name), 'utf8')
      const draft = parseAgentMarkdown(raw)
      agents.push({
        id: `dashboard:${agentName}`,
        name: agentName,
        plugin: 'dashboard',
        source: 'dashboard',
        description: (draft.description || '').slice(0, 140),
        skills: draft.skills || [],
        editable: true,
      })
    } catch {
      /* skip */
    }
  }
  return agents
}

async function listAgentMetaInDir(dir: string): Promise<any[]> {
  const agents: any[] = []
  for (const entry of await safeReadDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const name = entry.name.replace(/\.md$/, '')
    try {
      const raw = await readFile(joinPath(dir, entry.name), 'utf8')
      const draft: any = parseAgentMarkdown(raw)
      agents.push({
        name,
        description: draft.description || '',
        model: draft.model || '',
        editable: draft.created_by === 'dashboard' || draft.editable !== false,
      })
    } catch {
      agents.push({ name, description: '', model: '', editable: true })
    }
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name))
}

/** Lightweight metadata listing of custom agents (scope `project`) for the agent editor list. */
export async function listCustomAgentMeta(root: string): Promise<any[]> {
  return listAgentMetaInDir(customAgentsDir(root))
}

/** Same shape as `listCustomAgentMeta`, but for the `global` scope (`~/.claude/agents/`). */
export async function listGlobalAgentMeta(): Promise<any[]> {
  return listAgentMetaInDir(globalAgentsDir())
}

/** Read one custom agent's raw markdown + parsed draft, or null if invalid/missing. */
export async function readCustomAgent(root: string | null, name: string, scope: AgentScope = 'project') {
  const clean = sanitiseAgentName(name)
  if (!clean) return null
  const fp = joinPath(agentScopeDir(root, scope), `${clean}.md`)
  try {
    const content = await readTextFile(fp)
    const draft = parseAgentMarkdown(content)
    return { name: clean, content, draft, scope }
  } catch {
    return null
  }
}

/** Seed `agent-templates/default-agent.md` if it does not exist yet. */
export async function ensureDefaultTemplate(root: string): Promise<void> {
  const dir = agentTemplatesDir(root)
  await mkdir(dir, { recursive: true })
  const fp = joinPath(dir, 'default-agent.md')
  try {
    await access(fp)
  } catch {
    const draft = emptyDraft({
      name: 'default-agent',
      description: 'Agent mẫu — chỉnh sửa theo nhu cầu',
      sections: {
        role: 'Mô tả vai trò của agent.',
        workflow: '1. Bước đầu\n2. Bước tiếp theo',
        guardrail: '- Tuân thủ project rules',
        output: '- Ghi artifact vào task folder',
      },
    })
    await writeTextFile(fp, compileAgentMarkdown(draft))
  }
}

function bundledNlChatBuilderPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return joinPath(here, 'templates', 'nl-chat-builder.md')
}

/** Seed `custom-agents/nl-chat-builder.md` from the bundled default; never overwrites an existing file. */
export async function ensureNlChatBuilderAgent(root: string): Promise<void> {
  const dir = customAgentsDir(root)
  await mkdir(dir, { recursive: true })
  const fp = joinPath(dir, 'nl-chat-builder.md')
  try {
    await access(fp)
  } catch {
    const bundled = await readTextFile(bundledNlChatBuilderPath())
    await writeTextFile(fp, bundled)
  }
}

export interface FetchUrlSafeOptions {
  /** Extra request headers (e.g. API Accept / Authorization). */
  headers?: Record<string, string>
  /** HTTP method — defaults to GET. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Request body — only meaningful for non-GET methods. */
  body?: string
}

/** Fetch a user-supplied URL safely: https only, blocks private hosts (SSRF), 15s timeout, 512KB cap. */
export async function fetchUrlSafe(
  urlStr: string,
  options?: FetchUrlSafeOptions,
): Promise<string> {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    throw new Error('invalid URL')
  }
  if (u.protocol !== 'https:') throw new Error('only https URLs allowed')
  if (isPrivateHostname(u.hostname)) throw new Error('private hosts not allowed')
  const res = await fetch(urlStr, {
    method: options?.method ?? 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    ...(options?.headers ? { headers: options.headers } : {}),
    ...(options?.body !== undefined ? { body: options.body } : {}),
  })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const text = await res.text()
  if (text.length > 512_000) throw new Error('response too large')
  return text
}
