import {
  basename,
  dirname,
  homeDir,
  isAbsolutePath,
  joinPath,
  relativePath,
  resolvePathUnder,
  safeReadDir,
} from '../../../../backend/lib/fileHelper.js'
import {
  DENY_DIRS,
  SCAN_PATTERN_MAX_DEPTH,
  SCAN_PATTERN_MAX_DIRS,
  SCAN_PATTERN_MAX_MATCHES,
  expandScanPatterns,
  type PatternMatch,
} from '../scanPatterns.js'

export const RULE_CATEGORIES = ['coding', 'doc-writing', 'doc-review', 'test', 'git-pr', 'other']

export interface RuleItem {
  id: string
  name: string
  path: string
  scope: string
  category: string
}

/** Heuristically classify a rule file into one of RULE_CATEGORIES by its path/name. */
export function inferRuleCategory(filePath: string, fileName: string): string {
  const lower = `${filePath} ${fileName}`.toLowerCase()
  if (/coding|convention|style|guideline/.test(lower)) return 'coding'
  if (/doc-writing|document_writing|investigate|design|writing/.test(lower)) return 'doc-writing'
  if (/doc-review|code-review/.test(lower)) return 'doc-review'
  if (/\btest\b|testing|test-spec/.test(lower)) return 'test'
  if (/git|commit|\bpr\b|branch/.test(lower)) return 'git-pr'
  return 'other'
}

const RULE_FILE_EXT = /\.(md|mdc)$/i

function toRuleItem(full: string, scope: string, baseDir: string): RuleItem {
  const rel = relativePath(baseDir, full).replace(/\\/g, '/')
  const fileName = basename(full)
  return {
    id: `${scope}:${rel}`,
    name: fileName.replace(RULE_FILE_EXT, ''),
    path: rel,
    scope,
    category: inferRuleCategory(rel, fileName),
  }
}

/** Recursively collect .md/.mdc rule files under `dir` into `out`. */
export async function walkRuleFiles(
  dir: string,
  scope: string,
  baseDir: string,
  out: RuleItem[],
): Promise<void> {
  for (const entry of await safeReadDir(dir)) {
    const full = joinPath(dir, entry.name)
    if (entry.isDirectory()) {
      await walkRuleFiles(full, scope, baseDir, out)
      continue
    }
    if (!RULE_FILE_EXT.test(entry.name)) continue
    out.push(toRuleItem(full, scope, baseDir))
  }
}

interface RuleWalkBudget {
  dirs: number
  files: number
}

// xem docs/architecture/code/pipeline-editor.md §10
async function walkRuleFilesBounded(
  dir: string,
  baseDir: string,
  out: RuleItem[],
  depth: number,
  budget: RuleWalkBudget,
): Promise<void> {
  if (depth > SCAN_PATTERN_MAX_DEPTH) return
  if (budget.files >= SCAN_PATTERN_MAX_MATCHES || budget.dirs >= SCAN_PATTERN_MAX_DIRS) return
  budget.dirs++
  for (const entry of await safeReadDir(dir)) {
    if (DENY_DIRS.has(entry.name)) continue
    const full = joinPath(dir, entry.name)
    if (entry.isDirectory()) {
      await walkRuleFilesBounded(full, baseDir, out, depth + 1, budget)
      continue
    }
    if (!RULE_FILE_EXT.test(entry.name)) continue
    if (budget.files >= SCAN_PATTERN_MAX_MATCHES) return
    budget.files++
    out.push(toRuleItem(full, 'project', baseDir))
  }
}

async function scanRulesByPatterns(
  projectRoot: string,
  patterns: string[] | null | undefined,
  out: RuleItem[],
): Promise<void> {
  const budget: RuleWalkBudget = { dirs: 0, files: 0 }
  for (const match of await expandScanPatterns(projectRoot, patterns)) {
    if (match.isDirectory) {
      await walkRuleFilesBounded(match.path, projectRoot, out, 0, budget)
      continue
    }
    if (!RULE_FILE_EXT.test(match.path)) continue
    if (budget.files >= SCAN_PATTERN_MAX_MATCHES) break
    budget.files++
    out.push(toRuleItem(match.path, 'project', projectRoot))
  }
}

/**
 * Build the rules listing for a data root: project rules (`docs/agent-rules`,
 * `.claude/rules`, `scanPatterns.rules`) + global `~/.cursor/rules`.
 */
export async function buildRules(
  root: string,
  opts: { scanPatterns?: { rules?: string[] } | null } = {},
): Promise<{ rules: RuleItem[]; categories: string[] }> {
  const projectRoot = dirname(root)
  const found: RuleItem[] = []

  await walkRuleFiles(joinPath(projectRoot, 'docs', 'agent-rules'), 'project', projectRoot, found)
  await walkRuleFiles(joinPath(projectRoot, '.claude', 'rules'), 'project', projectRoot, found)
  await walkRuleFiles(joinPath(homeDir(), '.cursor', 'rules'), 'global', homeDir(), found)
  if (opts.scanPatterns?.rules?.length) {
    await scanRulesByPatterns(projectRoot, opts.scanPatterns.rules, found)
  }

  const byId = new Map<string, RuleItem>()
  for (const r of found) if (!byId.has(r.id)) byId.set(r.id, r)
  const rules = [...byId.values()]

  rules.sort(
    (a, b) =>
      a.scope.localeCompare(b.scope)
      || a.category.localeCompare(b.category)
      || a.name.localeCompare(b.name),
  )

  const foundCategories = new Set(rules.map((r) => r.category))
  const categories = RULE_CATEGORIES.filter((c) => foundCategories.has(c))

  return { rules, categories }
}

function isUnderBase(base: string, full: string): boolean {
  if (full === base) return true
  const rel = relativePath(base, full)
  return rel !== '' && !rel.startsWith('..') && !isAbsolutePath(rel)
}

/**
 * Resolve a rule's on-disk path from its listing id (`${scope}:${relPath}`).
 * A `project` id resolves only under one of `buildRules`' sources
 * (`docs/agent-rules`, `.claude/rules`, or a pre-expanded `scanPatterns.rules`
 * match passed via `extraAllowed`); otherwise returns null.
 * xem docs/architecture/code/pipeline-editor.md §9
 */
export function resolveRuleContentPath(
  projectRoot: string,
  id: string,
  extraAllowed: PatternMatch[] = [],
): string | null {
  const sep = id.indexOf(':')
  if (sep <= 0) return null
  const scope = id.slice(0, sep)
  const relPath = id.slice(sep + 1)
  if (!relPath || !RULE_FILE_EXT.test(relPath)) return null

  if (scope === 'global') return resolvePathUnder(homeDir(), relPath)
  if (scope !== 'project') return null

  const full = resolvePathUnder(projectRoot, relPath)
  if (!full) return null

  const fixedBases = [
    joinPath(projectRoot, 'docs', 'agent-rules'),
    joinPath(projectRoot, '.claude', 'rules'),
  ]
  if (fixedBases.some((base) => isUnderBase(base, full))) return full
  if (extraAllowed.some((m) => (m.isDirectory ? isUnderBase(m.path, full) : full === m.path))) return full
  return null
}

/** Async wrapper — expands `scanPatterns.rules` before delegating to the pure `resolveRuleContentPath`. */
export async function resolveRuleContentPathWithPatterns(
  projectRoot: string,
  id: string,
  opts: { scanPatterns?: { rules?: string[] } | null } = {},
): Promise<string | null> {
  const extraAllowed = opts.scanPatterns?.rules?.length
    ? await expandScanPatterns(projectRoot, opts.scanPatterns.rules)
    : []
  return resolveRuleContentPath(projectRoot, id, extraAllowed)
}
