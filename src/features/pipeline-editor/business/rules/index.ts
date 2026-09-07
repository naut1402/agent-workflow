import { basename, dirname, homeDir, joinPath, relativePath, safeReadDir } from '../../../../core/lib/fileHelper.js'
import { expandScanPatterns } from '../scanPatterns.js'

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
    if (!/\.(md|mdc)$/i.test(entry.name)) continue
    const rel = relativePath(baseDir, full).replace(/\\/g, '/')
    const name = entry.name.replace(/\.(md|mdc)$/i, '')
    out.push({
      id: `${scope}:${rel}`,
      name,
      path: rel,
      scope,
      category: inferRuleCategory(rel, entry.name),
    })
  }
}

/**
 * Rules from custom scan patterns. A matched directory is walked recursively;
 * a matched file becomes a single rule. Pattern rules are always project-scoped.
 */
async function scanRulesByPatterns(
  projectRoot: string,
  patterns: string[] | null | undefined,
  out: RuleItem[],
): Promise<void> {
  for (const match of await expandScanPatterns(projectRoot, patterns)) {
    if (match.isDirectory) {
      await walkRuleFiles(match.path, 'project', projectRoot, out)
      continue
    }
    if (!/\.(md|mdc)$/i.test(match.path)) continue
    const rel = relativePath(projectRoot, match.path).replace(/\\/g, '/')
    const fileName = basename(match.path)
    out.push({
      id: `project:${rel}`,
      name: fileName.replace(/\.(md|mdc)$/i, ''),
      path: rel,
      scope: 'project',
      category: inferRuleCategory(rel, fileName),
    })
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
