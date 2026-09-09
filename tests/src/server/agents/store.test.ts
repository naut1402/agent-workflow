import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  globalAgentsDir,
  listCustomAgentMeta,
  listGlobalAgentMeta,
  readCustomAgent,
  scanCustomAgents,
} from '../../../../src/features/agent-editor/business/agents'

const FOO = `---
name: foo
description: A foo agent
model: claude-sonnet-4-6
skills: [survey-codebase]
created_by: dashboard
---
## Role

does foo
`

let root: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-store-'))
  await fs.mkdir(path.join(root, 'custom-agents'), { recursive: true })
  await fs.writeFile(path.join(root, 'custom-agents', 'foo.md'), FOO)
  await fs.writeFile(path.join(root, 'custom-agents', 'bar.md'), '---\nname: bar\n---\n')
  await fs.writeFile(path.join(root, 'custom-agents', 'ignore.txt'), 'nope')
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('scanCustomAgents', () => {
  test('lists .md agents in catalog shape with dashboard source', async () => {
    const agents = await scanCustomAgents(root)
    const foo = agents.find((a) => a.name === 'foo')
    expect(foo).toMatchObject({ id: 'dashboard:foo', source: 'dashboard', plugin: 'dashboard', editable: true })
    expect(foo.description).toBe('A foo agent')
    expect(foo.skills).toEqual(['survey-codebase'])
    expect(agents.map((a) => a.name).sort()).toEqual(['bar', 'foo'])
  })
  test('empty for a missing root', async () => {
    expect(await scanCustomAgents(path.join(root, 'nope'))).toEqual([])
  })
})

describe('listCustomAgentMeta', () => {
  test('returns sorted lightweight metadata', async () => {
    const meta = await listCustomAgentMeta(root)
    expect(meta.map((m) => m.name)).toEqual(['bar', 'foo'])
    const foo = meta.find((m) => m.name === 'foo')
    expect(foo).toMatchObject({ description: 'A foo agent', model: 'claude-sonnet-4-6', editable: true })
  })
})

describe('readCustomAgent', () => {
  test('reads raw content + parsed draft (scope defaults to project)', async () => {
    const r = await readCustomAgent(root, 'foo')
    expect(r?.name).toBe('foo')
    expect(r?.content).toContain('does foo')
    expect(r?.draft.description).toBe('A foo agent')
    expect(r?.scope).toBe('project')
  })
  test('returns null for a traversal / invalid name', async () => {
    expect(await readCustomAgent(root, '../secrets')).toBeNull()
  })
  test('returns null for a missing agent', async () => {
    expect(await readCustomAgent(root, 'doesnotexist')).toBeNull()
  })
})

// Regression coverage for 202608_005: an agent saved with `scope: 'global'`
// must live in `~/.claude/agents/` (resolved as `user:<name>` by the runner
// and catalog), completely independent of `root` — never the project dir.
describe('global scope (~/.claude/agents/)', () => {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  let home: string

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
    process.env.HOME = home
    process.env.USERPROFILE = home
    await fs.mkdir(path.join(home, '.claude', 'agents'), { recursive: true })
    await fs.writeFile(path.join(home, '.claude', 'agents', 'global-one.md'), '---\nname: global-one\n---\n')
  })

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    await fs.rm(home, { recursive: true, force: true })
  })

  test('globalAgentsDir() points at ~/.claude/agents', () => {
    expect(globalAgentsDir()).toBe(path.join(home, '.claude', 'agents'))
  })

  test('listGlobalAgentMeta() lists the global dir, independent of a project root', async () => {
    const meta = await listGlobalAgentMeta()
    expect(meta.map((m) => m.name)).toEqual(['global-one'])
  })

  test('readCustomAgent(root, name, "global") reads from the global dir, not the project dir', async () => {
    const r = await readCustomAgent(root, 'global-one', 'global')
    expect(r?.name).toBe('global-one')
    expect(r?.scope).toBe('global')
  })

  test('readCustomAgent(root, name, "project") does not see a global-only agent', async () => {
    expect(await readCustomAgent(root, 'global-one', 'project')).toBeNull()
  })
})
