import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ensureDefaultTemplate } from '../../../server/agents/templates'

let root: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-tpl-'))
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('ensureDefaultTemplate', () => {
  const fp = () => path.join(root, 'agent-templates', 'default-agent.md')

  test('creates default-agent.md with a YAML frontmatter block', async () => {
    await ensureDefaultTemplate(root)
    const content = await fs.readFile(fp(), 'utf8')
    expect(content.startsWith('---\n')).toBe(true)
    expect(content).toContain('name: default-agent')
  })

  test('is idempotent — does not overwrite an edited template', async () => {
    await fs.writeFile(fp(), 'EDITED')
    await ensureDefaultTemplate(root)
    expect(await fs.readFile(fp(), 'utf8')).toBe('EDITED')
  })
})
