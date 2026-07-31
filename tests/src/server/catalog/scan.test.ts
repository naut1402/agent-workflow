import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { findMarketplaceJson, scanPlugin, scanSkillsFlatDir } from '../../../../src/server/catalog/scan'

let root: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-scan-'))
  // A plugin with one skill and one agent.
  const plugin = path.join(root, 'plug')
  await fs.mkdir(path.join(plugin, 'skills', 'my-skill'), { recursive: true })
  await fs.writeFile(
    path.join(plugin, 'skills', 'my-skill', 'SKILL.md'),
    '---\nname: my-skill\ndescription: does things\n---\nbody',
  )
  await fs.mkdir(path.join(plugin, 'agents'), { recursive: true })
  await fs.writeFile(
    path.join(plugin, 'agents', 'my-agent.md'),
    '---\ndescription: an agent\nskills: [my-skill]\n---\nrole',
  )
  // A contract (non user-invocable) skill to exercise the opts filter.
  await fs.mkdir(path.join(plugin, 'skills', 'contract'), { recursive: true })
  await fs.writeFile(
    path.join(plugin, 'skills', 'contract', 'SKILL.md'),
    '---\nname: contract\nuser-invocable: false\n---\n',
  )
  // marketplace.json a couple levels up for findMarketplaceJson.
  const deep = path.join(root, 'a', 'b')
  await fs.mkdir(path.join(root, '.claude-plugin'), { recursive: true })
  await fs.mkdir(deep, { recursive: true })
  await fs.writeFile(
    path.join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ plugins: [{ name: 'plug', source: './plug' }] }),
  )
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('scanPlugin', () => {
  test('discovers skills and agents with ids/source/description', async () => {
    const { skills, agents } = await scanPlugin(path.join(root, 'plug'), 'repo:plug', 'plug')
    const skillNames = skills.map((s) => s.name).sort()
    expect(skillNames).toEqual(['contract', 'my-skill'])
    const my = skills.find((s) => s.name === 'my-skill')
    expect(my).toMatchObject({ id: 'repo:plug:my-skill', source: 'repo:plug', plugin: 'plug', description: 'does things', user_invocable: true })
    expect(skills.find((s) => s.name === 'contract')?.user_invocable).toBe(false)
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ id: 'repo:plug:my-agent', source: 'repo:plug', skills: ['my-skill'] })
  })

  test('excludes contract skills when includeContractSkills=false', async () => {
    const { skills } = await scanPlugin(path.join(root, 'plug'), 'repo:plug', 'plug', { includeContractSkills: false })
    expect(skills.map((s) => s.name)).toEqual(['my-skill'])
  })

  test('returns empty for a non-existent plugin dir', async () => {
    expect(await scanPlugin(path.join(root, 'nope'), 'repo:x', 'x')).toEqual({ skills: [], agents: [] })
  })
})

describe('scanSkillsFlatDir', () => {
  test('scans a flat skills root', async () => {
    const skills = await scanSkillsFlatDir(path.join(root, 'plug', 'skills'), 'user', 'user')
    expect(skills.map((s) => s.name).sort()).toEqual(['contract', 'my-skill'])
    expect(skills[0].source).toBe('user')
  })
})

describe('findMarketplaceJson', () => {
  test('walks up to find .claude-plugin/marketplace.json', async () => {
    const found = await findMarketplaceJson(path.join(root, 'a', 'b'))
    expect(found?.dir).toBe(root)
    expect(found?.data.plugins[0].name).toBe('plug')
  })
  test('returns null when none found', async () => {
    expect(await findMarketplaceJson(os.tmpdir())).toBeNull()
  })
})
