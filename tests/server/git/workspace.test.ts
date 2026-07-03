import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RunGitFn } from '../../../server/git/workspace'
import {
  cleanupWorkspace,
  cloneShallow,
  pullOrReclone,
  workspaceDir,
} from '../../../server/git/workspace'

let home: string
const saved: Record<string, string | undefined> = {}

function mockRunGit(impl?: Partial<Record<string, () => Promise<{ stdout: string; stderr: string }>>>): RunGitFn {
  return async (args) => {
    const cmd = args[0]
    if (impl?.[cmd]) return impl[cmd]!()
    if (cmd === 'clone') {
      const targetDir = args[args.length - 1]
      fs.mkdirSync(path.join(targetDir, '.dev-team-agent'), { recursive: true })
      return { stdout: '', stderr: '' }
    }
    if (cmd === 'pull') return { stdout: '', stderr: '' }
    throw new Error(`unexpected git: ${args.join(' ')}`)
  }
}

beforeEach(() => {
  saved.HOME = process.env.DEV_TEAM_DASHBOARD_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'git-ws-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (saved.HOME === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = saved.HOME
})

describe('workspaceDir', () => {
  test('lives under registry home workspaces', () => {
    expect(workspaceDir('my-id')).toBe(path.join(home, 'workspaces', 'my-id'))
  })
})

describe('cloneShallow', () => {
  test('invokes git clone with depth 1 and branch', async () => {
    const calls: string[][] = []
    const runGit: RunGitFn = async (args) => {
      calls.push(args)
      const targetDir = args[args.length - 1]
      fs.mkdirSync(path.join(targetDir, '.dev-team-agent'), { recursive: true })
      return { stdout: '', stderr: '' }
    }
    const target = workspaceDir('p1')
    await cloneShallow({ url: 'https://github.com/o/r.git', branch: 'main', targetDir: target, runGit })
    expect(calls[0]).toEqual(['clone', '--depth', '1', '-b', 'main', 'https://github.com/o/r.git', target])
    expect(fs.existsSync(path.join(target, '.dev-team-agent'))).toBe(true)
  })
})

describe('pullOrReclone', () => {
  test('returns pulled when pull succeeds', async () => {
    const root = workspaceDir('pull-ok')
    fs.mkdirSync(path.join(root, '.dev-team-agent'), { recursive: true })
    const r = await pullOrReclone({
      cloneRoot: root,
      url: 'https://github.com/o/r.git',
      branch: 'main',
      runGit: mockRunGit(),
    })
    expect(r).toBe('pulled')
  })

  test('re-clones when pull fails', async () => {
    const root = workspaceDir('reclone')
    fs.mkdirSync(path.join(root, '.dev-team-agent'), { recursive: true })
    let pullCalls = 0
    const runGit: RunGitFn = async (args) => {
      if (args[0] === 'pull') {
        pullCalls++
        throw new Error('pull failed')
      }
      const targetDir = args[args.length - 1]
      fs.mkdirSync(path.join(targetDir, '.dev-team-agent'), { recursive: true })
      return { stdout: '', stderr: '' }
    }
    const r = await pullOrReclone({
      cloneRoot: root,
      url: 'https://github.com/o/r.git',
      branch: 'main',
      runGit,
    })
    expect(r).toBe('recloned')
    expect(pullCalls).toBe(1)
    expect(fs.existsSync(path.join(root, '.dev-team-agent'))).toBe(true)
  })
})

describe('cleanupWorkspace', () => {
  test('removes directory', () => {
    const dir = workspaceDir('rm')
    fs.mkdirSync(dir, { recursive: true })
    cleanupWorkspace(dir)
    expect(fs.existsSync(dir)).toBe(false)
  })
})
