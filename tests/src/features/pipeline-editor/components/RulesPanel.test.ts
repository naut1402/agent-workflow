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
      props: { rules: [rule], categories: ['doc-writing'], steps: [] },
    })
    expect(w.text()).toContain('— không dùng bởi step nào')
  })

  it('renders the en translation under the en locale', () => {
    const w = mount(RulesPanel, {
      props: { rules: [rule], categories: ['doc-writing'], steps: [] },
      global: { plugins: [createTestI18n('en')] },
    })
    expect(w.text()).toContain('— not used by any step')
  })
})
