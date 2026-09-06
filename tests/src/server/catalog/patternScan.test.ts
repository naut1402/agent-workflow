import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  SCAN_PATTERN_MAX_DEPTH,
  SCAN_PATTERN_MAX_MATCHES,
  expandScanPatterns,
} from '../../../../src/features/pipeline-editor/business/scanPatterns'
import {
  scanAgentsByPatterns,
  scanSkillsByPatterns,
} from '../../../../src/features/pipeline-editor/business/catalog/scan'

let root: string

const rel = (matches: { path: string }[]) =>
  matches.map((m) => path.relative(root, m.path).replace(/\\/g, '/')).sort()

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pattern-scan-'))
  const mk = (...p: string[]) => fs.mkdir(path.join(root, ...p), { recursive: true })
  const wr = (rel: string, body: string) => fs.writeFile(path.join(root, rel), body)

  // Agents that ignore the convention: a flat dir of *.agent.md plus a nested dir.
  await mk('.agents')
  await wr('.agents/investigator.agent.md', '---\ndescription: looks around\n---\nbody')
  await wr('.agents/no-frontmatter.md', 'just body')
  await wr('.agents/notes.txt', 'ignored')
  await mk('tools', 'squad', 'agents')
  await wr('tools/squad/agents/designer.md', '---\ndescription: designs\n---\nbody')

  // A frontmatter name that differs from the file name.
  await mk('custom')
  await wr('custom/weird-file-name.md', '---\nname: real-agent-name\ndescription: renamed\n---\n')

  // Skills: one conventional <slug>/SKILL.md tree, one flat file per skill.
  await mk('packages', 'core', 'skills', 'build-thing')
  await wr(
    'packages/core/skills/build-thing/SKILL.md',
    '---\nname: build-thing\ndescription: builds\n---\n',
  )
  await mk('flat-skills')
  await wr('flat-skills/lint-code.md', '---\ndescription: lints\n---\n')
  await mk('entry-skill')
  await wr('entry-skill/SKILL.md', '---\ndescription: no name here\n---\n')

  // Denylisted + dot directories that must never be walked into by a wildcard.
  await mk('node_modules', 'pkg', 'agents')
  await wr('node_modules/pkg/agents/nope.md', '---\n---\n')
  await mk('.hidden', 'agents')
  await wr('.hidden/agents/nope.md', '---\n---\n')

  // Deep chain to exercise the depth ceiling (root/d1/…/d12).
  let deep = ''
  for (let i = 1; i <= 12; i++) {
    deep = deep ? `${deep}/d${i}` : 'd1'
    await mk(...deep.split('/'))
  }
  await wr('d1/d2/d3/marker.md', '# shallow')
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('expandScanPatterns — matching', () => {
  test('literal path matches a directory', async () => {
    const out = await expandScanPatterns(root, ['.agents'])
    expect(rel(out)).toEqual(['.agents'])
    expect(out[0].isDirectory).toBe(true)
  })

  test('* matches files within one segment only', async () => {
    const out = await expandScanPatterns(root, ['.agents/*.md'])
    expect(rel(out)).toEqual(['.agents/investigator.agent.md', '.agents/no-frontmatter.md'])
    expect(out.every((m) => !m.isDirectory)).toBe(true)
  })

  test('* in the middle of a path matches one directory level', async () => {
    const out = await expandScanPatterns(root, ['tools/*/agents'])
    expect(rel(out)).toEqual(['tools/squad/agents'])
  })

  test('? matches exactly one character', async () => {
    expect(rel(await expandScanPatterns(root, ['d?']))).toEqual(['d1'])
    expect(await expandScanPatterns(root, ['d??'])).toEqual([])
  })

  test('** spans multiple levels', async () => {
    const out = await expandScanPatterns(root, ['**/agents'])
    expect(rel(out)).toEqual(['tools/squad/agents'])
  })

  test('** also matches zero segments', async () => {
    const out = await expandScanPatterns(root, ['**/d1'])
    expect(rel(out)).toContain('d1')
  })

  test('a pattern ending in ** matches the directory itself and its subtree', async () => {
    const out = await expandScanPatterns(root, ['tools/**'])
    expect(rel(out)).toEqual(['tools', 'tools/squad', 'tools/squad/agents'])
  })

  test('wildcards never match dot-names, but a literal dot-name does', async () => {
    expect(rel(await expandScanPatterns(root, ['*/agents']))).toEqual([])
    expect(rel(await expandScanPatterns(root, ['.hidden/agents']))).toEqual(['.hidden/agents'])
  })

  test('denylisted directories are skipped', async () => {
    expect(await expandScanPatterns(root, ['**/pkg'])).toEqual([])
    expect(await expandScanPatterns(root, ['node_modules'])).toEqual([])
  })

  test('deduplicates paths matched by two patterns', async () => {
    const out = await expandScanPatterns(root, ['.agents', './.agents', '.agents/'])
    expect(rel(out)).toEqual(['.agents'])
  })

  test('stops at the depth ceiling instead of walking forever', async () => {
    const out = await expandScanPatterns(root, ['**'])
    const depths = out.map((m) => path.relative(root, m.path).split(path.sep).length)
    expect(Math.max(...depths)).toBeLessThanOrEqual(SCAN_PATTERN_MAX_DEPTH)
  })

  test('never returns more than the match ceiling', async () => {
    const out = await expandScanPatterns(root, ['**', '**/*'])
    expect(out.length).toBeLessThanOrEqual(SCAN_PATTERN_MAX_MATCHES)
  })
})

describe('expandScanPatterns — guards', () => {
  test('drops patterns containing ..', async () => {
    expect(await expandScanPatterns(root, ['../..', 'tools/../../etc'])).toEqual([])
  })

  test('never returns a path outside the project root', async () => {
    const out = await expandScanPatterns(root, ['**', '**/*.md'])
    // `**` alone resolves to the project root itself; everything else must be under it.
    expect(out.every((m) => m.path === root || m.path.startsWith(root + path.sep))).toBe(true)
  })

  test('empty / missing input returns nothing', async () => {
    expect(await expandScanPatterns(root, [])).toEqual([])
    expect(await expandScanPatterns(root, null)).toEqual([])
    expect(await expandScanPatterns(root, undefined)).toEqual([])
    expect(await expandScanPatterns('', ['.agents'])).toEqual([])
  })

  test('a pattern matching nothing returns nothing, without throwing', async () => {
    expect(await expandScanPatterns(root, ['does/not/exist/*.md'])).toEqual([])
  })
})

describe('scanAgentsByPatterns', () => {
  test('a matched directory goes through the normal directory scanner', async () => {
    const agents = await scanAgentsByPatterns(root, ['tools/*/agents'])
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({
      id: 'project:designer',
      name: 'designer',
      source: 'project',
      plugin: 'project',
      description: 'designs',
    })
  })

  test('a matched file is loaded on its own, dropping the .agent suffix', async () => {
    const agents = await scanAgentsByPatterns(root, ['.agents/*.md'])
    expect(agents.map((a) => a.name).sort()).toEqual(['investigator', 'no-frontmatter'])
    expect(agents.find((a) => a.name === 'investigator')).toMatchObject({
      id: 'project:investigator',
      description: 'looks around',
    })
  })

  test('frontmatter name wins over the file name on the pattern branch', async () => {
    const agents = await scanAgentsByPatterns(root, ['custom/*.md'])
    expect(agents.map((a) => a.name)).toEqual(['real-agent-name'])
    expect(agents[0].id).toBe('project:real-agent-name')
  })

  test('non-markdown matches are ignored', async () => {
    const agents = await scanAgentsByPatterns(root, ['.agents/*.txt'])
    expect(agents).toEqual([])
  })

  test('no patterns means no work', async () => {
    expect(await scanAgentsByPatterns(root, [])).toEqual([])
    expect(await scanAgentsByPatterns(root, undefined)).toEqual([])
  })
})

describe('scanSkillsByPatterns', () => {
  test('a matched directory is read as a flat skills root', async () => {
    const skills = await scanSkillsByPatterns(root, ['packages/*/skills'])
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      id: 'project:build-thing',
      name: 'build-thing',
      source: 'project',
      description: 'builds',
      user_invocable: true,
    })
  })

  test('a matched flat file becomes one skill named after the file', async () => {
    const skills = await scanSkillsByPatterns(root, ['flat-skills/*.md'])
    expect(skills.map((s) => s.name)).toEqual(['lint-code'])
    expect(skills[0].id).toBe('project:lint-code')
  })

  test('a matched SKILL.md without a name falls back to its folder name', async () => {
    const skills = await scanSkillsByPatterns(root, ['entry-skill/SKILL.md'])
    expect(skills.map((s) => s.name)).toEqual(['entry-skill'])
  })

  test('no patterns means no work', async () => {
    expect(await scanSkillsByPatterns(root, [])).toEqual([])
    expect(await scanSkillsByPatterns(root, null)).toEqual([])
  })
})
