import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addFromGit } from '../../server/registry'
import {
  createMcpServer,
  fail,
  handleAddProject,
  handleGetProject,
  handleListProjects,
  handleRemoveProject,
  ok,
} from '../../mcp/server'
import type { RunGitFn } from '../../server/git/workspace'

let home: string
let proj: string
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved.HOME = process.env.DEV_TEAM_DASHBOARD_HOME
  saved.ROOT = process.env.DEV_TEAM_ROOT
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-home-'))
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proj-'))
  fs.mkdirSync(path.join(proj, '.dev-team-agent'), { recursive: true })
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DEV_TEAM_ROOT
})
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(proj, { recursive: true, force: true })
  if (saved.HOME === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = saved.HOME
  if (saved.ROOT === undefined) delete process.env.DEV_TEAM_ROOT
  else process.env.DEV_TEAM_ROOT = saved.ROOT
})

const payload = (r: any) => JSON.parse(r.content[0].text)

describe('ok / fail envelopes', () => {
  test('ok wraps JSON text content', () => {
    expect(payload(ok({ a: 1 }))).toEqual({ a: 1 })
  })
  test('fail sets isError + message', () => {
    const r = fail('boom')
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toBe('boom')
  })
})

describe('tool handlers over a temp registry', () => {
  test('add → list → get → remove flow', async () => {
    const added = await handleAddProject({ path: proj })
    const project = payload(added).project
    expect(project.default).toBe(true)

    expect(payload(handleListProjects()).projects).toHaveLength(1)
    expect(payload(handleGetProject({ id: project.id })).project.id).toBe(project.id)

    // default project cannot be removed → fail envelope
    const rm = handleRemoveProject({ id: project.id })
    expect(rm.isError).toBe(true)
  })

  test('get unknown id → fail', () => {
    expect(handleGetProject({ id: 'nope' }).isError).toBe(true)
  })

  test('add invalid path → fail', async () => {
    expect((await handleAddProject({ path: 'relative/x' })).isError).toBe(true)
  })

  test('add gitUrl with mocked clone', async () => {
    const runGit: RunGitFn = async (args) => {
      if (args[0] === 'clone') {
        const targetDir = args[args.length - 1]
        fs.mkdirSync(path.join(targetDir, '.dev-team-agent'), { recursive: true })
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    }
    const direct = await addFromGit({
      gitUrl: 'https://github.com/org/mcp-repo.git',
      runGit,
    })
    expect(direct.ok).toBe(true)
    if (direct.ok) {
      const listed = payload(handleListProjects())
      expect(listed.projects.some((p: { id: string }) => p.id === direct.project.id)).toBe(true)
    }
  })

  test('add requires path or gitUrl', async () => {
    expect((await handleAddProject({})).isError).toBe(true)
    expect((await handleAddProject({ path: proj, gitUrl: 'https://x' })).isError).toBe(true)
  })
})

describe('createMcpServer', () => {
  test('builds a server without connecting a transport', () => {
    expect(createMcpServer()).toBeTruthy()
  })
})
