import { describe, expect, it } from 'vitest'
// agentMarkdown is still plain JS (TS conversion deferred to the strict phase);
// it relocated to shared/ in this module so backend + frontend share one home.
import {
  compileAgentMarkdown,
  emptyDraft,
  parseAgentMarkdown,
} from '@shared/agentMarkdown.js'

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
