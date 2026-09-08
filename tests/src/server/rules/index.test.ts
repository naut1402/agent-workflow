import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildRules, inferRuleCategory, RULE_CATEGORIES, walkRuleFiles, type RuleItem } from '../../../../src/features/pipeline-editor/business/rules/index'

describe('inferRuleCategory', () => {
  test.each([
    ['rules/coding-conventions.md', 'coding-conventions.md', 'coding'],
    ['rules/style-guide.md', 'style-guide.md', 'coding'],
    ['rules/design-writing.md', 'design-writing.md', 'doc-writing'],
    ['rules/doc-review.md', 'doc-review.md', 'doc-review'],
    ['rules/code-review.md', 'code-review.md', 'doc-review'],
    ['rules/testing.md', 'testing.md', 'test'],
    ['rules/git-pr.md', 'git-pr.md', 'git-pr'],
    ['rules/commit-rules.md', 'commit-rules.md', 'git-pr'],
    ['rules/branch-naming.md', 'branch-naming.md', 'git-pr'],
    // 'style' wins over git keywords (coding regex is checked first) — characterized.
    ['rules/commit-style.md', 'commit-style.md', 'coding'],
    ['rules/misc.md', 'misc.md', 'other'],
  ])('classifies %s as %s', (p, f, expected) => {
    expect(inferRuleCategory(p, f)).toBe(expected)
  })
})

describe('walkRuleFiles', () => {
  let dir: string
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-walk-'))
    await fs.mkdir(path.join(dir, 'nested'), { recursive: true })
    await fs.writeFile(path.join(dir, 'coding.md'), '# coding')
    await fs.writeFile(path.join(dir, 'nested', 'testing.mdc'), '# test')
    await fs.writeFile(path.join(dir, 'ignore.txt'), 'nope')
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('collects .md/.mdc recursively, ignores other files', async () => {
    const out: RuleItem[] = []
    await walkRuleFiles(dir, 'project', dir, out)
    const names = out.map((r) => r.name).sort()
    expect(names).toEqual(['coding', 'testing'])
  })

  test('records relative path with forward slashes, scope and category', async () => {
    const out: RuleItem[] = []
    await walkRuleFiles(dir, 'project', dir, out)
    const testing = out.find((r) => r.name === 'testing')!
    expect(testing.path).toBe('nested/testing.mdc')
    expect(testing.id).toBe('project:nested/testing.mdc')
    expect(testing.scope).toBe('project')
    expect(testing.category).toBe('test')
  })

  test('returns nothing for a missing directory', async () => {
    const out: RuleItem[] = []
    await walkRuleFiles(path.join(dir, 'nope'), 'project', dir, out)
    expect(out).toEqual([])
  })
})

describe('buildRules', () => {
  let projectRoot: string
  let root: string
  beforeAll(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-build-'))
    root = path.join(projectRoot, '.dev-team-agent')
    await fs.mkdir(path.join(projectRoot, '.claude', 'rules'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.claude', 'rules', 'coding-conv.md'), '# c')
    await fs.mkdir(path.join(projectRoot, 'docs', 'agent-rules'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'docs', 'agent-rules', 'testing.md'), '# t')
  })
  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  test('discovers project rules and reports categories ⊆ RULE_CATEGORIES', async () => {
    const { rules, categories } = await buildRules(root)
    expect(rules.some((r) => r.name === 'coding-conv' && r.scope === 'project')).toBe(true)
    expect(categories).toContain('coding')
    expect(categories.every((c) => RULE_CATEGORIES.includes(c))).toBe(true)
  })

  test('discovers tool-agnostic rules in docs/agent-rules alongside legacy .claude/rules', async () => {
    const { rules, categories } = await buildRules(root)
    const testing = rules.find((r) => r.name === 'testing')
    expect(testing).toBeDefined()
    expect(testing!.scope).toBe('project')
    expect(testing!.path).toBe('docs/agent-rules/testing.md')
    expect(categories).toContain('test')
  })
})

describe('buildRules with custom scan patterns', () => {
  let projectRoot: string
  let root: string
  beforeAll(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-patterns-'))
    root = path.join(projectRoot, '.dev-team-agent')
    await fs.mkdir(path.join(projectRoot, 'docs', 'agent-rules'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'docs', 'agent-rules', 'testing.md'), '# t')
    // Off-convention rules, reachable only through a pattern.
    await fs.mkdir(path.join(projectRoot, 'guides', 'nested'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'guides', 'house-style.md'), '# s')
    await fs.writeFile(path.join(projectRoot, 'guides', 'nested', 'deep-notes.mdc'), '# d')
    await fs.writeFile(path.join(projectRoot, 'guides', 'notes.txt'), 'ignored')
    await fs.mkdir(path.join(projectRoot, 'single'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'single', 'one-off.md'), '# o')
    // Denylisted dirs, both at the root and nested inside a monorepo-style package:
    // a directory match must never walk into either.
    await fs.mkdir(path.join(projectRoot, 'node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'node_modules', 'pkg', 'README.md'), '# junk')
    await fs.mkdir(path.join(projectRoot, 'packages', 'app', 'node_modules', 'dep'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(projectRoot, 'packages', 'app', 'node_modules', 'dep', 'README.md'),
      '# junk',
    )
    await fs.writeFile(path.join(projectRoot, 'packages', 'app', 'house-rules.md'), '# real')
  })
  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  test('omitting scanPatterns matches passing an empty list', async () => {
    const without = await buildRules(root)
    const withEmpty = await buildRules(root, { scanPatterns: { rules: [] } })
    expect(withEmpty).toEqual(without)
  })

  test('a matched directory is walked recursively, non-markdown ignored', async () => {
    const { rules } = await buildRules(root, { scanPatterns: { rules: ['guides'] } })
    const fromPattern = rules.filter((r) => r.path.startsWith('guides/'))
    expect(fromPattern.map((r) => r.path).sort()).toEqual([
      'guides/house-style.md',
      'guides/nested/deep-notes.mdc',
    ])
    expect(fromPattern.every((r) => r.scope === 'project')).toBe(true)
  })

  test('a matched file becomes a single rule with an inferred category', async () => {
    const { rules } = await buildRules(root, { scanPatterns: { rules: ['single/one-off.md'] } })
    // Matched on path + scope, not on `name`: the user-scope scan reads the real
    // `$HOME`, where a rule of the same name would otherwise be picked up first
    // and make this pass (or fail) for reasons that have nothing to do with the
    // pattern under test.
    const one = rules.find((r) => r.path === 'single/one-off.md' && r.scope === 'project')
    expect(one).toMatchObject({
      id: 'project:single/one-off.md',
      path: 'single/one-off.md',
      scope: 'project',
      category: 'other',
    })
  })

  test('a pattern pointing back at a default directory does not duplicate rules', async () => {
    const { rules } = await buildRules(root, { scanPatterns: { rules: ['docs/**'] } })
    const testing = rules.filter((r) => r.path === 'docs/agent-rules/testing.md')
    expect(testing).toHaveLength(1)
  })

  test('two overlapping patterns do not duplicate rules', async () => {
    const { rules } = await buildRules(root, {
      scanPatterns: { rules: ['guides', 'guides/*.md'] },
    })
    expect(rules.filter((r) => r.path === 'guides/house-style.md')).toHaveLength(1)
  })

  test('patterns never touch the global scope line', async () => {
    const before = (await buildRules(root)).rules.filter((r) => r.scope === 'global')
    const after = (await buildRules(root, { scanPatterns: { rules: ['**'] } })).rules.filter(
      (r) => r.scope === 'global',
    )
    expect(after).toEqual(before)
  })

  test('a pattern matching nothing leaves the listing unchanged', async () => {
    const before = await buildRules(root)
    const after = await buildRules(root, { scanPatterns: { rules: ['nope/**/*.md'] } })
    expect(after).toEqual(before)
  })

  // `**` matches zero segments, so it yields projectRoot itself. The directory branch
  // must apply the denylist itself — the expander's ceilings stop at finding the dir.
  test('a directory match never walks into a denylisted directory', async () => {
    const { rules } = await buildRules(root, { scanPatterns: { rules: ['**'] } })
    expect(rules.filter((r) => r.path.includes('node_modules'))).toEqual([])
    // The real file sitting next to a nested node_modules is still collected.
    expect(rules.some((r) => r.path === 'packages/app/house-rules.md')).toBe(true)
  })

  test('a directory match reached through an explicit path is denylisted too', async () => {
    const { rules } = await buildRules(root, { scanPatterns: { rules: ['packages/app'] } })
    expect(rules.filter((r) => r.path.includes('node_modules'))).toEqual([])
    expect(rules.some((r) => r.path === 'packages/app/house-rules.md')).toBe(true)
  })
})
