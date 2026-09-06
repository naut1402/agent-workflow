import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveAgent, resolveAgentFilePath } from '../../../../src/features/runner/business/agentResolver.js'

// Regression test for a real bug caught via the job-log payload (see PR history):
// any agent markdown with an intro paragraph before the first canonical heading,
// or a non-canonical heading like "Đầu vào" (as in the bundled dev-agent-teams
// `doc-reviewer.md`), lands in the shared parser's `unclassified` bucket — which
// `buildSystemPrompt` used to render once via the ordered loop AND once more via
// an explicit fallback, sending the runner a system prompt with that whole block
// duplicated verbatim.

const AGENT_MD = `---
name: testagent
description: test agent with an unclassified heading
skills:
  - doc-review
---

# Test Agent

Intro đoạn văn mô tả agent.

**Không sửa file gốc** — chỉ đọc và đánh giá.

## Vai trò

- role bullet

## Đầu vào

Some input description.

## Workflow

step 1

## Kết quả trả về

output description
`

describe('resolveAgent — system prompt assembly', () => {
  test('does not duplicate the unclassified (intro + non-canonical heading) block', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agent-project-'))
    try {
      const agentsDir = path.join(projectRoot, '.claude', 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(path.join(agentsDir, 'testagent.md'), AGENT_MD, 'utf8')

      const resolved = await resolveAgent('project:testagent', { projectRoot, devTeamRoot: projectRoot })

      // Each section appears in the assembled prompt exactly once.
      expect(resolved.systemPrompt).toContain('## Vai trò')
      expect(resolved.systemPrompt).toContain('## Workflow')
      expect(resolved.systemPrompt).toContain('## Report output')
      expect(countOccurrences(resolved.systemPrompt, 'Some input description.')).toBe(1)
      expect(countOccurrences(resolved.systemPrompt, 'Intro đoạn văn mô tả agent.')).toBe(1)
      expect(countOccurrences(resolved.systemPrompt, '## Đầu vào')).toBe(1)
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})

describe('resolveAgent — blank ref (ad-hoc, no agent file)', () => {
  test('returns a stub with no system prompt instead of throwing', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agent-project-'))
    try {
      const resolved = await resolveAgent('', { projectRoot, devTeamRoot: projectRoot })
      expect(resolved.systemPrompt).toBe('')
      expect(resolved.ref).toBe('')
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})

describe('resolveAgent — bundled plugin fallback', () => {
  test('resolves plugin ref from DEV_TEAM_BUNDLED_PLUGINS when cache misses', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agent-project-'))
    const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-bundled-'))
    const prevBundle = process.env.DEV_TEAM_BUNDLED_PLUGINS
    try {
      const agentsDir = path.join(bundleRoot, 'zzz-test-bundle', 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'hello.md'),
        `---\nname: hello\ndescription: bundled\nskills: []\n---\n\n# Hello\n\n## Vai trò\n\nbundle role\n`,
        'utf8',
      )
      process.env.DEV_TEAM_BUNDLED_PLUGINS = bundleRoot
      const resolved = await resolveAgent('plugin:zzz-test-bundle:hello', {
        projectRoot,
        devTeamRoot: projectRoot,
      })
      expect(resolved.name).toBe('hello')
      expect(resolved.systemPrompt).toContain('bundle role')
      expect(resolved.agentFilePath).toBe(path.join(agentsDir, 'hello.md'))
    } finally {
      if (prevBundle === undefined) delete process.env.DEV_TEAM_BUNDLED_PLUGINS
      else process.env.DEV_TEAM_BUNDLED_PLUGINS = prevBundle
      fs.rmSync(projectRoot, { recursive: true, force: true })
      fs.rmSync(bundleRoot, { recursive: true, force: true })
    }
  })
})

describe('resolveAgent — path sanitisation', () => {
  test('rejects plugin/agent refs with path traversal segments', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-agent-project-'))
    try {
      const secrets = path.join(projectRoot, 'secrets-passwd', 'agents')
      fs.mkdirSync(secrets, { recursive: true })
      fs.writeFileSync(path.join(secrets, 'evil.md'), '# evil\n', 'utf8')
      // Would resolve under projectRoot/plugins/../../secrets-passwd without sanitise.
      await expect(
        resolveAgent('plugin:../../secrets-passwd:evil', {
          projectRoot,
          devTeamRoot: projectRoot,
        }),
      ).rejects.toThrow()
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})

describe('resolveAgent — dashboard agent', () => {
  test('resolves an existing dashboard: agent from custom-agents/', async () => {
    const devTeamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-devteam-'))
    try {
      const agentsDir = path.join(devTeamRoot, 'custom-agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'create-issue.md'),
        `---\nname: create-issue\ndescription: create issue\nskills: []\n---\n\n# Create Issue\n\n## Vai trò\n\ncreate issues\n`,
        'utf8',
      )
      const resolved = await resolveAgent('dashboard:create-issue', {
        projectRoot: devTeamRoot,
        devTeamRoot,
      })
      expect(resolved.name).toBe('create-issue')
      expect(resolved.agentFilePath).toBe(path.join(agentsDir, 'create-issue.md'))
    } finally {
      fs.rmSync(devTeamRoot, { recursive: true, force: true })
    }
  })

  test('rejects a missing dashboard: agent with a hint listing available agents', async () => {
    const devTeamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-devteam-'))
    try {
      const agentsDir = path.join(devTeamRoot, 'custom-agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(path.join(agentsDir, 'create-issue.md'), '# Create Issue\n', 'utf8')

      await expect(
        resolveAgent('dashboard:create-gh-issue', { projectRoot: devTeamRoot, devTeamRoot }),
      ).rejects.toThrow(/create-gh-issue\.md.*create-issue/)
    } finally {
      fs.rmSync(devTeamRoot, { recursive: true, force: true })
    }
  })

  test('rejects a missing dashboard: agent without a stray empty hint when custom-agents/ does not exist', async () => {
    const devTeamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-devteam-'))
    try {
      let error: unknown
      try {
        await resolveAgent('dashboard:create-gh-issue', { projectRoot: devTeamRoot, devTeamRoot })
      } catch (err) {
        error = err
      }
      expect(String(error)).toContain('create-gh-issue.md')
      expect(String(error)).not.toContain('agent có sẵn trong project')
    } finally {
      fs.rmSync(devTeamRoot, { recursive: true, force: true })
    }
  })
})

describe('resolveAgent — user (global) agent', () => {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  let home: string
  let agentsDir: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-userhome-'))
    process.env.HOME = home
    process.env.USERPROFILE = home
    agentsDir = path.join(home, '.claude', 'agents')
    fs.mkdirSync(agentsDir, { recursive: true })
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    fs.rmSync(home, { recursive: true, force: true })
  })

  test('resolves an existing user: agent from ~/.claude/agents/', async () => {
    fs.writeFileSync(
      path.join(agentsDir, 'shared-agent.md'),
      `---\nname: shared-agent\ndescription: shared\nskills: []\n---\n\n## Vai trò\n\nshared\n`,
      'utf8',
    )
    const resolved = await resolveAgent('user:shared-agent', { projectRoot: home, devTeamRoot: home })
    expect(resolved.name).toBe('shared-agent')
    expect(resolved.agentFilePath).toBe(path.join(agentsDir, 'shared-agent.md'))
  })

  test('rejects a missing user: agent with a hint listing available global agents', async () => {
    fs.writeFileSync(path.join(agentsDir, 'shared-agent.md'), '# Shared\n', 'utf8')

    await expect(
      resolveAgent('user:missing-agent', { projectRoot: home, devTeamRoot: home }),
    ).rejects.toThrow(/missing-agent\.md.*shared-agent/)
  })

  test('rejects a missing user: agent without a stray empty hint when the dir does not exist', async () => {
    fs.rmSync(agentsDir, { recursive: true, force: true })

    let error: unknown
    try {
      await resolveAgent('user:missing-agent', { projectRoot: home, devTeamRoot: home })
    } catch (err) {
      error = err
    }
    expect(String(error)).toContain('missing-agent.md')
    expect(String(error)).not.toContain('agent có sẵn (global)')
  })
})

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// Guard for the repo-tracked plugin override: `plugins/dev-agent-teams/agents/investigator.md`
// is a symlink onto `docs/template/agents/investigator.md` (single source of truth) and sits at
// the highest-priority slot in `resolveAgentFilePath`, so the in-repo agent wins over a stale
// `~/.claude/plugins/cache` copy. A checkout without symlink support (Windows default,
// `core.symlinks=false`) turns it into a text file holding the link path — the agent then parses
// as empty and the runner silently falls back to the cached, outdated instructions.
describe('repo plugin override — investigator', () => {
  const repoRoot = path.resolve(import.meta.dir, '..', '..', '..', '..')
  const overridePath = path.join(repoRoot, 'plugins', 'dev-agent-teams', 'agents', 'investigator.md')

  test('resolves to docs/template/agents/investigator.md via symlink', async () => {
    expect(fs.lstatSync(overridePath).isSymbolicLink()).toBe(true)
    expect(fs.realpathSync(overridePath)).toBe(
      fs.realpathSync(path.join(repoRoot, 'docs', 'template', 'agents', 'investigator.md')),
    )
  })

  test('takes priority over the plugin cache for the pipeline agent ref', async () => {
    const resolved = await resolveAgentFilePath(repoRoot, repoRoot, 'dev-agent-teams:investigator')
    expect(resolved).toBe(overridePath)
  })
})
