import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import CatalogPanel from '@/features/pipeline-editor/components/CatalogPanel.vue'

// Catalog chỉ còn mục Agents — mục Skills bị gỡ cùng field `skills` của step.
// Trạng thái mở do PipelineEditor giữ (`openSections`), dùng chung với RulesPanel.

const catalog = {
  agents: [
    { id: 'investigator', name: 'investigator', description: 'survey codebase', plugin: 'dev', source: 'repo', skills: ['survey'] },
    { id: 'reviewer', name: 'reviewer', description: 'review diff', plugin: 'dev', source: 'repo', skills: [] },
  ],
  skills: [{ id: 'survey', name: 'survey-codebase', description: 'how to survey', plugin: 'dev', source: 'repo' }],
}

function mountPanel(openSections = new Set(['agents'])) {
  return mountWithI18n(CatalogPanel, { props: { catalog, openSections } })
}

describe('CatalogPanel', () => {
  it('renders Agents as the only collapsible section, with its count', () => {
    const w = mountPanel()
    const sections = w.findAll('.editor-section')
    expect(sections).toHaveLength(1)
    expect(sections[0].text()).toContain('Agents')
    // count badge = số item sau filter nguồn
    expect(sections[0].find('.editor-section-count').text()).toBe('2')
    expect(w.find('.catalog-tabs').exists()).toBe(false)
  })

  it('renders agents from the catalog', () => {
    const w = mountPanel()
    expect(w.text()).toContain('investigator')
    expect(w.text()).toContain('reviewer')
  })

  it('does not render the skills catalog any more', () => {
    const w = mountPanel(new Set(['agents', 'skills']))
    expect(w.text()).not.toContain('survey-codebase')
    expect(w.findAll('.catalog-search')).toHaveLength(1)
  })

  it('open prop drives whether the section is expanded', () => {
    const w = mountPanel(new Set())
    expect((w.find('.editor-section').element as HTMLDetailsElement).open).toBe(false)
  })

  // Panel chỉ giành chiều cao khi section của nó mở — xem docs/ui-overflow.md.
  it('marks the root panel open only while the agents section is expanded', () => {
    expect(mountPanel().find('.catalog-panel--open').exists()).toBe(true)
    expect(mountPanel(new Set()).find('.catalog-panel--open').exists()).toBe(false)
  })

  it('clicking the section header emits toggle-section with its key', async () => {
    const w = mountPanel()
    await w.find('.editor-section-head').trigger('click')
    expect(w.emitted('toggle-section')).toEqual([['agents']])
  })

  it('tolerates an empty catalog without crashing', () => {
    const w = mountWithI18n(CatalogPanel, {
      props: { catalog: { agents: [], skills: [] }, openSections: new Set(['agents']) },
    })
    expect(w.text()).toContain('Không có agent nào')
  })
})
