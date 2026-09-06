import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountWithI18n, createTestI18n } from '../../../helpers/i18n'
import RulesPanel from '@/features/pipeline-editor/components/RulesPanel.vue'

// RulesPanel calls useI18n() after the pipelineEditor i18n migration, so it must
// mount with the i18n plugin installed (mountWithI18n / createTestI18n).

const rule = { id: 'r1', name: 'doc rule', path: 'rules/doc.md', category: 'doc-writing', scope: 'project' }

describe('RulesPanel (i18n)', () => {
  it('renders the vi "no step" hint (default locale) when a rule is unused', () => {
    const w = mountWithI18n(RulesPanel, {
      props: { rules: [rule], categories: ['doc-writing'], steps: [], openSections: new Set(['rules']) },
    })
    expect(w.text()).toContain('— không dùng bởi step nào')
  })

  it('renders the en translation under the en locale', () => {
    const w = mount(RulesPanel, {
      props: { rules: [rule], categories: ['doc-writing'], steps: [], openSections: new Set(['rules']) },
      global: { plugins: [createTestI18n('en')] },
    })
    expect(w.text()).toContain('— not used by any step')
  })
})

// c.1 — Rules là một mục collapsible cùng cấp Agents / Skills, không còn head tự vẽ.
describe('RulesPanel — mục collapsible', () => {
  it('renders one section titled Rules with the rule count', () => {
    const w = mountWithI18n(RulesPanel, {
      props: { rules: [rule], categories: ['doc-writing'], steps: [], openSections: new Set(['rules']) },
    })
    const section = w.find('.editor-section')
    expect(section.exists()).toBe(true)
    expect(section.text()).toContain('Rules')
    expect(w.find('.editor-section-count').text()).toBe('1')
    expect(w.find('.rules-panel-head').exists()).toBe(false)
  })

  it('is collapsed when its key is not in openSections', () => {
    const w = mountWithI18n(RulesPanel, {
      props: { rules: [rule], categories: [], steps: [], openSections: new Set() },
    })
    expect((w.find('.editor-section').element as HTMLDetailsElement).open).toBe(false)
  })

  it('clicking the header emits toggle-section with "rules"', async () => {
    const w = mountWithI18n(RulesPanel, {
      props: { rules: [rule], categories: [], steps: [], openSections: new Set(['rules']) },
    })
    await w.find('.editor-section-head').trigger('click')
    expect(w.emitted('toggle-section')).toEqual([['rules']])
  })

  it('renders the i18n empty state when there is no rule', () => {
    const w = mountWithI18n(RulesPanel, {
      props: { rules: [], categories: [], steps: [], openSections: new Set(['rules']) },
    })
    expect(w.text()).toContain('Không có rule nào')
  })
})
