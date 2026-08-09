import { parseAgentMarkdown, compileAgentMarkdown, emptyDraft } from './agentMarkdown.js'
import {
  access,
  dirname,
  fileURLToPath,
  joinPath,
  mkdir,
  readFile,
  readTextFile,
  safeReadDir,
  writeTextFile,
} from '../../../core/lib/fileHelper.js'

// ── paths under data root ──────────────────────────────────────────────────

export function profilesDir(root: string): string {
  return joinPath(root, 'pipeline-profiles')
}

export function customAgentsDir(root: string): string {
  return joinPath(root, 'custom-agents')
}

export function agentTemplatesDir(root: string): string {
  return joinPath(root, 'agent-templates')
}

export function workflowStepTemplatesDir(root: string): string {
  return joinPath(root, 'workflow-step-templates')
}

// ── name + CRUD / catalog listing ──────────────────────────────────────────

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

/** Lightweight metadata listing of custom agents for the agent editor list. */
export async function listCustomAgentMeta(root: string): Promise<any[]> {
  const dir = customAgentsDir(root)
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

/** Read one custom agent's raw markdown + parsed draft, or null if invalid/missing. */
export async function readCustomAgent(root: string, name: string) {
  const clean = sanitiseAgentName(name)
  if (!clean) return null
  const fp = joinPath(customAgentsDir(root), `${clean}.md`)
  try {
    const content = await readTextFile(fp)
    const draft = parseAgentMarkdown(content)
    return { name: clean, content, draft }
  } catch {
    return null
  }
}

// ── seed templates ─────────────────────────────────────────────────────────

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

/** Absolute path of the bundled `nl-chat-builder.md` source, alongside this file. */
function bundledNlChatBuilderPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return joinPath(here, 'templates', 'nl-chat-builder.md')
}

/**
 * Seed `custom-agents/nl-chat-builder.md` (the agent `submitJob` resolves via
 * `agentRef: 'dashboard:nl-chat-builder'`) from the bundled default the first
 * time the NL chat surface is used for this project. Never overwrites an
 * existing file — a user may have customized it.
 */
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

// ── safe outbound fetch (agent URL import + peer GitHub) ───────────────────

export interface FetchUrlSafeOptions {
  /** Extra request headers (e.g. API Accept / Authorization). */
  headers?: Record<string, string>
}

/** True for hostnames that resolve to private / loopback ranges (SSRF guard). */
export function isPrivateHostname(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  return false
}

/**
 * Fetch a user-supplied URL safely: https only, blocks private hosts (SSRF),
 * 15s timeout, 512KB cap. Reuse for any outbound fetch of user URLs.
 */
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
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    ...(options?.headers ? { headers: options.headers } : {}),
  })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const text = await res.text()
  if (text.length > 512_000) throw new Error('response too large')
  return text
}
