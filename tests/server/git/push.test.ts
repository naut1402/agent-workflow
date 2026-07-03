import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RunGitFn } from '../../../server/git/workspace.js'
import {
  findGitRoot,
  pushDevTeamArtifacts,
  pushGitWorkspace,
  resolveDevTeamRelativePath,
} from '../../../server/git/push.js'
import type { Project } from '../../../shared/schemas/project.js'

function makeGitRepo(root: string): string {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  const devTeam = path.join(root, '.dev-team-agent')
  fs.mkdirSync(devTeam, { recursive: true })
  return devTeam
}

function mockRunGit(handlers: Partial<Record<string, (args: string[]) => Promise<{ stdout: string; stderr: string }>>>): RunGitFn {
  return async (args) => {
    const cmd = args[0]
    if (handlers[cmd]) return handlers[cmd]!(args)
    throw new Error(`unexpected git: ${args.join(' ')}`)
  }
}

describe('findGitRoot', () => {
  test('walks up to .git', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'push-root-'))
    const devTeam = makeGitRepo(root)
    expect(findGitRoot(devTeam)).toBe(root)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('returns null outside git', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-nogit-'))
    expect(findGitRoot(dir)).toBe(null)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('resolveDevTeamRelativePath', () => {
  test('returns .dev-team-agent from repo root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'push-rel-'))
    const devTeam = makeGitRepo(root)
    expect(resolveDevTeamRelativePath(devTeam, root)).toBe('.dev-team-agent')
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('pushDevTeamArtifacts', () => {
  let root: string
  let devTeam: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'push-art-'))
    devTeam = makeGitRepo(root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('adds scoped path, commits and pushes when changes exist', async () => {
    const calls: string[][] = []
    const runGit = mockRunGit({
      add: async (args) => {
        calls.push(args)
        return { stdout: '', stderr: '' }
      },
      status: async () => ({ stdout: ' M .dev-team-agent/tasks/x.md\n', stderr: '' }),
      commit: async (args) => {
        calls.push(args)
        return { stdout: '', stderr: '' }
      },
      'rev-parse': async () => ({ stdout: 'abc123\n', stderr: '' }),
      push: async (args) => {
        calls.push(args)
        return { stdout: '', stderr: '' }
      },
    })

    const result = await pushDevTeamArtifacts({
      gitRoot: root,
      devTeamRel: '.dev-team-agent',
      branch: 'main',
      runGit,
    })

    expect(result).toEqual({ ok: true, pushed: true, commit: 'abc123', branch: 'main' })
    expect(calls[0]).toEqual(['add', '--', '.dev-team-agent'])
    expect(calls.some((c) => c[0] === 'commit')).toBe(true)
    expect(calls.some((c) => c[0] === 'push' && c[1] === 'origin' && c[2] === 'main')).toBe(true)
  })

  test('returns pushed false when porcelain is empty', async () => {
    const runGit = mockRunGit({
      add: async () => ({ stdout: '', stderr: '' }),
      status: async () => ({ stdout: '', stderr: '' }),
    })

    const result = await pushDevTeamArtifacts({
      gitRoot: root,
      devTeamRel: '.dev-team-agent',
      branch: 'main',
      runGit,
    })

    expect(result).toEqual({ ok: true, pushed: false, branch: 'main' })
  })
})

describe('pushGitWorkspace', () => {
  let root: string
  let devTeam: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'push-ws-'))
    devTeam = makeGitRepo(root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('rejects path outside git repo', async () => {
    const nogit = fs.mkdtempSync(path.join(os.tmpdir(), 'push-nogit2-'))
    const project: Project = {
      id: 'p1',
      name: 'p1',
      kind: 'local',
      path: nogit,
      addedAt: new Date().toISOString(),
      default: true,
    }
    const result = await pushGitWorkspace(project)
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'project path is not inside a git repository',
    })
    fs.rmSync(nogit, { recursive: true, force: true })
  })

  test('rejects kind git when origin URL mismatches', async () => {
    const runGit = mockRunGit({
      'remote': async () => ({ stdout: 'https://github.com/other/repo.git\n', stderr: '' }),
      'rev-parse': async (args) =>
        args.includes('--abbrev-ref')
          ? { stdout: 'main\n', stderr: '' }
          : { stdout: 'abc\n', stderr: '' },
    })

    const project: Project = {
      id: 'p1',
      name: 'p1',
      kind: 'git',
      path: devTeam,
      addedAt: new Date().toISOString(),
      default: true,
      source: {
        type: 'git',
        url: 'https://github.com/org/repo.git',
        branch: 'main',
      },
    }

    const result = await pushGitWorkspace(project, { runGit })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.status).toBe(400)
      expect(result.error).toContain('origin URL does not match')
    }
  })

  test('pushes local kind project inside git repo', async () => {
    const runGit = mockRunGit({
      'remote': async () => ({ stdout: 'https://github.com/org/repo.git\n', stderr: '' }),
      'rev-parse': async (args) =>
        args.includes('--abbrev-ref')
          ? { stdout: 'main\n', stderr: '' }
          : { stdout: 'deadbeef\n', stderr: '' },
      add: async () => ({ stdout: '', stderr: '' }),
      status: async () => ({ stdout: ' M .dev-team-agent/x\n', stderr: '' }),
      commit: async () => ({ stdout: '', stderr: '' }),
      push: async () => ({ stdout: '', stderr: '' }),
    })

    const project: Project = {
      id: 'p1',
      name: 'p1',
      kind: 'local',
      path: devTeam,
      addedAt: new Date().toISOString(),
      default: true,
    }

    const result = await pushGitWorkspace(project, { runGit })
    expect(result).toEqual({ ok: true, pushed: true, commit: 'deadbeef', branch: 'main' })
  })
})
