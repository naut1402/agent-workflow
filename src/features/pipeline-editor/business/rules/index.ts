import { basename, dirname, homeDir, joinPath, relativePath, safeReadDir } from '../../../../core/lib/fileHelper.js'
import {
  DENY_DIRS,
  SCAN_PATTERN_MAX_DEPTH,
  SCAN_PATTERN_MAX_DIRS,
  SCAN_PATTERN_MAX_MATCHES,
  expandScanPatterns,
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
 * Same collection as `walkRuleFiles`, but for a directory reached through a USER
 * pattern rather than one of the three fixed sources.
 *
 * The ceilings in `expandScanPatterns` only bound the search for the matching
 * directory — they say nothing about what lives inside it. `**` matches zero
 * segments, so it yields `projectRoot` itself; handing that to the unbounded
 * walker means reading every `.md` under `node_modules` (900+ in this repo), plus
 * every `node_modules` nested under a monorepo package. The denylist and budget
 * therefore have to be enforced here, at the point of the actual work.
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
 *
 * Project rules live in `docs/agent-rules` (dùng chung cho mọi agent) hoặc `.claude/rules`
 * (bố cục cũ, riêng một công cụ) — quét cả hai nên repo dùng layout nào cũng ra.
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
