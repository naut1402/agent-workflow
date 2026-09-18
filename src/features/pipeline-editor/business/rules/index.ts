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

/** Describe one rule file relative to the base it was collected under. */
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

/**
 * Same as `walkRuleFiles`, but for a directory reached through a user pattern.
 * `expandScanPatterns`'s ceilings only bound the search for the matching dir, not
 * what's inside it — `**` can yield `projectRoot` itself, and an unbounded walk
 * from there means reading every `.md` under every `node_modules`. Denylist and
 * budget are therefore enforced here, at the point of actual work.
 */
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

/**
 * Rules from custom scan patterns. A matched directory is walked recursively
 * under a shared budget; a matched file becomes a single rule. Pattern rules are
 * always project-scoped.
 */
async function scanRulesByPatterns(
  projectRoot: string,
  patterns: string[] | null | undefined,
  out: RuleItem[],
): Promise<void> {
  // One budget for the whole batch — 20 patterns must not each get a fresh 200.
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
 * Build the rules listing for a data root: project rules + global `~/.cursor/rules`.
 * Project rules live in `docs/agent-rules` (shared by every agent) or the older
 * `.claude/rules` layout (single tool) — scanning both works regardless of layout.
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
  // Pattern rules only ever run against projectRoot — the global ~/.cursor/rules line is untouched.
  if (opts.scanPatterns?.rules?.length) {
    await scanRulesByPatterns(projectRoot, opts.scanPatterns.rules, found)
  }

  // A pattern may point back at a default directory (e.g. `docs/**`); keep the first hit.
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

/** True when `full` is `base` itself or a path descendant of it. */
function isUnderBase(base: string, full: string): boolean {
  if (full === base) return true
  const rel = relativePath(base, full)
  return rel !== '' && !rel.startsWith('..') && !isAbsolutePath(rel)
}

/**
 * Resolve a rule's on-disk path from its listing id (`${scope}:${relPath}`).
 * `resolvePathUnder` alone blocks `..` but not an arbitrary `.md` that merely
 * lives under the project and was never listed by `buildRules` — the id must
 * also land under one of `buildRules`' actual sources (`docs/agent-rules`,
 * `.claude/rules`, or a pre-expanded `scanPatterns.rules` match passed via
 * `extraAllowed`, since this function stays sync/pure). `global` scope is
 * unaffected — only `project` was over-broad.
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

/**
 * Async wrapper — expands `scanPatterns.rules` (the one allowed-base source
 * that needs I/O) before delegating to the pure `resolveRuleContentPath`.
 */
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
