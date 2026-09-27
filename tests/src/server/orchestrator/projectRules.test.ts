import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ensureProjectRulesFile,
  extractRuleSection,
  scanRootRuleSections,
} from '../../../../src/features/orchestrator/business/projectRules'

// `root` ở đây là thư mục `.dev-team-agent` — cùng quy ước `root` mọi nơi khác
// trong orchestrator (`projectRoot = dirname(root)`).
let projectRoot: string
let root: string

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-rules-root-'))
  root = path.join(projectRoot, '.dev-team-agent')
  fs.mkdirSync(root, { recursive: true })
})
afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }))

describe('scanRootRuleSections — rule nhúng trực tiếp trong AGENTS.md/CLAUDE.md', () => {
  test('nhận diện section theo heading khớp category (TC-10)', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'AGENTS.md'),
      '# AGENTS.md\n\n## Coding convention\n\nDùng 2 space, không dùng tab.\n\n## Không liên quan\n\nblah\n',
      'utf8',
    )
    const sections = await scanRootRuleSections(projectRoot)
    expect(sections.coding?.body).toContain('Dùng 2 space')
    expect(sections.coding?.source).toContain('AGENTS.md#Coding convention')
  })

  test('AGENTS.md vắng mặt → fallback CLAUDE.md', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'CLAUDE.md'),
      '## Investigate & design writing\n\nMỗi doc có 7 mục.\n',
      'utf8',
    )
    const sections = await scanRootRuleSections(projectRoot)
    expect(sections['doc-writing']?.body).toContain('7 mục')
  })

  test('cả hai file đều vắng → rỗng, không lỗi', async () => {
    expect(await scanRootRuleSections(projectRoot)).toEqual({})
  })
})

describe('ensureProjectRulesFile', () => {
  test('không có rule nào → vẫn sinh file, liệt kê "Không tìm thấy" (TC-11)', async () => {
    const doc = await ensureProjectRulesFile(root)
    expect(doc).toContain('# Project Convention Rules')
    expect(doc).toContain('Không tìm thấy')
    expect(fs.existsSync(path.join(root, 'project-rules.md'))).toBe(true)
  })

  test('idempotent — gọi lần 2 không ghi đè nội dung đã có', async () => {
    const first = await ensureProjectRulesFile(root)
    const dest = path.join(root, 'project-rules.md')
    fs.writeFileSync(dest, `${first}\n<!-- đã sửa tay -->`, 'utf8')
    const second = await ensureProjectRulesFile(root)
    expect(second).toContain('đã sửa tay')
  })

  test('file có sẵn do đường điều phối khác ghi trước → đọc nguyên văn, không ghi đè (TC-13/TC-14)', async () => {
    const dest = path.join(root, 'project-rules.md')
    const external = '# Project Convention Rules\n\n## Rule coding\n**Nguồn**: CLI ngoài\nDo CLI sinh.\n'
    fs.writeFileSync(dest, external, 'utf8')
    const doc = await ensureProjectRulesFile(root)
    expect(doc).toBe(external)
  })

  test('rule nhúng trong AGENTS.md ưu tiên hơn file trong docs/agent-rules (TC-12 hai category cùng lúc)', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'AGENTS.md'),
      '## Coding convention\n\nRule từ AGENTS.md.\n',
      'utf8',
    )
    fs.mkdirSync(path.join(projectRoot, 'docs', 'agent-rules'), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'docs', 'agent-rules', 'testing.md'), 'Rule test từ file riêng.', 'utf8')

    const doc = await ensureProjectRulesFile(root)
    expect(doc).toContain('Rule từ AGENTS.md.')
    expect(doc).toContain('Rule test từ file riêng.')
  })
})

describe('extractRuleSection', () => {
  const md = [
    '# Project Convention Rules',
    '',
    '## Rule coding',
    '**Nguồn**: x',
    'nội dung coding',
    '',
    '## Rule test',
    '**Nguồn**: y',
    'nội dung test',
  ].join('\n')

  test('category đơn — lấy đúng section, không lẫn section khác', () => {
    expect(extractRuleSection(md, 'coding')).toContain('nội dung coding')
    expect(extractRuleSection(md, 'coding')).not.toContain('nội dung test')
  })

  test('nhiều category — gộp đủ cả hai (TC-12)', () => {
    const out = extractRuleSection(md, ['coding', 'test'])
    expect(out).toContain('nội dung coding')
    expect(out).toContain('nội dung test')
  })

  test('category không có section → null, caller tự viết "Chưa thiết lập"', () => {
    expect(extractRuleSection(md, 'git-pr')).toBeNull()
  })
})
