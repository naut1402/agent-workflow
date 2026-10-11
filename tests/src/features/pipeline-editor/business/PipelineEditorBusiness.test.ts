import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PipelineEditorBusiness } from '../../../../../src/features/pipeline-editor/business/PipelineEditorBusiness'

// #447 (Tfb77cf90-P8): Facade catalog — lắp port `CatalogAgentStore` từ agent-editor,
// gọi fallback `plugins/` của id `repo:`, trả data hoặc `{ status, error }`.

const savedHome = process.env.HOME
const savedUserProfile = process.env.USERPROFILE

let home: string
let projectRoot: string
let root: string

async function write(file: string, body: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'pe-facade-home-'))
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pe-facade-proj-'))
  root = path.join(projectRoot, '.dev-team-agent')
  await fs.mkdir(root, { recursive: true })
  process.env.HOME = home
  process.env.USERPROFILE = home
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  if (savedUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = savedUserProfile
  await fs.rm(home, { recursive: true, force: true })
  await fs.rm(projectRoot, { recursive: true, force: true })
})

describe('PipelineEditorBusiness — không có root', () => {
  test('mọi thao tác catalog trả 404 unknown project', async () => {
    const biz = new PipelineEditorBusiness(null)
    expect(await biz.getCatalog()).toEqual({ status: 404, error: 'unknown project' })
    expect(await biz.getCatalogAgent('user:x')).toEqual({ status: 404, error: 'unknown project' })
    expect(await biz.getSkillContent('user:x')).toEqual({ status: 404, error: 'unknown project' })
  })
})

describe('PipelineEditorBusiness.getCatalog', () => {
  test('lô dashboard và user đi qua kho agent của agent-editor', async () => {
    await write(path.join(root, 'custom-agents', 'mine.md'), '---\ndescription: mine\n---\n\n## Vai trò\n\nx\n')
    await write(path.join(home, '.claude', 'agents', 'global.md'), '---\ndescription: g\n---\n')
    const cat = await new PipelineEditorBusiness(root).getCatalog()
    if ('error' in cat) throw new Error(cat.error)
    expect(cat.agents.map((a) => a.id)).toEqual(['user:global', 'dashboard:mine'])
  })
})

describe('PipelineEditorBusiness.getCatalogAgent', () => {
  test('user:<name> đọc từ thư mục agent cấp máy của agent-editor', async () => {
    await write(path.join(home, '.claude', 'agents', 'global.md'), '---\ndescription: from home\nskills: [a, b]\n---\n')
    const r = await new PipelineEditorBusiness(root).getCatalogAgent('user:global')
    if ('error' in r) throw new Error(r.error)
    expect(r.path).toBe(path.join(home, '.claude', 'agents', 'global.md'))
    expect(r.draft.description).toBe('from home')
    expect(r.draft.skills).toEqual(['a', 'b'])
  })

  test('repo: không có marketplace.json → fallback plugins/', async () => {
    await write(path.join(projectRoot, 'plugins', 'p', 'agents', 'a.md'), '---\ndescription: builtin\n---\n')
    const r = await new PipelineEditorBusiness(root).getCatalogAgent('repo:p:a')
    if ('error' in r) throw new Error(r.error)
    expect(r.path).toBe(path.join(projectRoot, 'plugins', 'p', 'agents', 'a.md'))
  })

  test('repo: fallback plugins/ — pluginName/name không qua whitelist → 404', async () => {
    await write(path.join(projectRoot, 'plugins', 'p', 'agents', 'a.md'), '---\ndescription: builtin\n---\n')
    const biz = new PipelineEditorBusiness(root)
    const notFound = { status: 404, error: 'agent file not found' }
    expect(await biz.getCatalogAgent('repo:../p:a')).toEqual(notFound)
    expect(await biz.getCatalogAgent('repo:p:../agents/a')).toEqual(notFound)
  })

  test('không file nào → 404 agent file not found', async () => {
    expect(await new PipelineEditorBusiness(root).getCatalogAgent('user:ghost')).toEqual({
      status: 404,
      error: 'agent file not found',
    })
    expect(await new PipelineEditorBusiness(root).getCatalogAgent('bogus')).toEqual({
      status: 404,
      error: 'agent file not found',
    })
  })

  test('lỗi đọc khác ENOENT → 500 kèm thông điệp lỗi', async () => {
    await fs.mkdir(path.join(root, 'custom-agents', 'isdir.md'), { recursive: true })
    const r = await new PipelineEditorBusiness(root).getCatalogAgent('dashboard:isdir')
    expect('error' in r && r.status).toBe(500)
  })
})

describe('PipelineEditorBusiness.getSkillContent', () => {
  test('user:<name> → nội dung SKILL.md', async () => {
    await write(path.join(home, '.claude', 'skills', 's', 'SKILL.md'), 'SKILL BODY')
    expect(await new PipelineEditorBusiness(root).getSkillContent('user:s')).toEqual({
      id: 'user:s',
      content: 'SKILL BODY',
    })
  })

  test('repo: không có marketplace.json → fallback plugins/, pluginName bị sanitise', async () => {
    await write(path.join(projectRoot, 'plugins', 'p', 'skills', 's', 'SKILL.md'), 'BUILTIN')
    const biz = new PipelineEditorBusiness(root)
    expect(await biz.getSkillContent('repo:p:s')).toEqual({ id: 'repo:p:s', content: 'BUILTIN' })
    expect(await biz.getSkillContent('repo:../p:s')).toEqual({ status: 404, error: 'skill file not found' })
  })
})
