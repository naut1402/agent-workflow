import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveAgent } from '../../../server/runners/agentResolver.js'

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

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}
