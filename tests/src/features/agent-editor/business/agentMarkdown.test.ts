import { describe, expect, it } from 'bun:test'
// agentMarkdown is still plain JS (TS conversion deferred to the strict phase).
import {
  compileAgentMarkdown,
  draftFromAgentMarkdown,
  emptyDraft,
  parseAgentMarkdown,
} from '../../../../../src/features/agent-editor/business/agentMarkdown.js'

describe('agentMarkdown round-trip', () => {
  it('compile → parse preserves frontmatter + section content', () => {
    const draft = emptyDraft({
      name: 'investigator',
      description: 'Survey the codebase',
      model: 'claude-sonnet-4-6',
      skills: ['survey-codebase'],
      sections: {
        role: 'You investigate.',
        skills: '',
        workflow: 'Step 1\n\nStep 2',
        guardrail: '',
        output: 'investigate.md',
        unclassified: '',
      },
    })

    const md = compileAgentMarkdown(draft)
    const parsed = parseAgentMarkdown(md)

    expect(parsed.name).toBe('investigator')
    expect(parsed.description).toBe('Survey the codebase')
    expect(parsed.model).toBe('claude-sonnet-4-6')
    expect(parsed.skills).toEqual(['survey-codebase'])
    expect(parsed.sections.role).toBe('You investigate.')
    expect(parsed.sections.workflow).toBe('Step 1\n\nStep 2')
    expect(parsed.sections.output).toBe('investigate.md')
  })

  it('parses markdown without frontmatter into the role section', () => {
    const parsed = parseAgentMarkdown('just some prose')
    expect(parsed.sections.role).toBe('just some prose')
    expect(parsed.name).toBe('')
  })

  it('compiled output starts with a YAML frontmatter block', () => {
    const md = compileAgentMarkdown(emptyDraft({ name: 'x' }))
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('name: x')
  })
})

// TC-D2/TC-D7: draftFromAgentMarkdown là nguồn của luồng "sao chép" agent —
// tên đề xuất luôn phái sinh từ agent gốc, không trùng y nguyên, và không tự
// tăng số qua nhiều lần gọi (hành vi có sẵn, không phải yêu cầu mới của task).
describe('draftFromAgentMarkdown — dựng draft "sao chép" từ markdown agent gốc', () => {
  const md = compileAgentMarkdown(
    emptyDraft({
      name: 'foo',
      description: 'Agent gốc',
      model: 'claude-sonnet-4-6',
      skills: ['coding-rules'],
      sections: { role: 'Vai trò gốc', workflow: '1. Bước 1' },
    }),
  )

  it('tên đề xuất là "<tên gốc>-copy", khác tên gốc', () => {
    const draft = draftFromAgentMarkdown(md, { name: 'foo' })
    expect(draft.name).toBe('foo-copy')
    expect(draft.name).not.toBe('foo')
  })

  it('nội dung khác (mô tả, model, skills, section) lấy nguyên theo agent gốc', () => {
    const draft = draftFromAgentMarkdown(md, { name: 'foo' })
    expect(draft.description).toBe('Agent gốc')
    expect(draft.model).toBe('claude-sonnet-4-6')
    expect(draft.skills).toEqual(['coding-rules'])
    expect(draft.sections.role).toBe('Vai trò gốc')
    expect(draft.sections.workflow).toBe('1. Bước 1')
  })

  it('gọi lại nhiều lần cho cùng agent gốc ⇒ tên đề xuất giống nhau, không tự tăng số (TC-D7)', () => {
    const first = draftFromAgentMarkdown(md, { name: 'foo' })
    const second = draftFromAgentMarkdown(md, { name: 'foo' })
    expect(first.name).toBe(second.name)
    expect(second.name).toBe('foo-copy')
  })

  it('không có tên agent gốc (upload file rời) ⇒ suy tên từ frontmatter của chính file, vẫn có hậu tố -copy', () => {
    const draft = draftFromAgentMarkdown(md, {})
    expect(draft.name).toBe('foo-copy')
  })
})
