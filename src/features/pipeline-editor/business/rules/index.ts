import { dirname, homeDir, joinPath, relativePath, safeReadDir } from '../../../../core/lib/fileHelper.js'

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

/** Build the rules listing for a data root: project `.claude/rules` + global `~/.cursor/rules`. */
export async function buildRules(root: string): Promise<{ rules: RuleItem[]; categories: string[] }> {
  const projectRoot = dirname(root)
  const rules: RuleItem[] = []

  await walkRuleFiles(joinPath(projectRoot, '.claude', 'rules'), 'project', projectRoot, rules)
  await walkRuleFiles(joinPath(homeDir(), '.cursor', 'rules'), 'global', homeDir(), rules)

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
