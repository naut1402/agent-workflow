import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import CatalogPanel from '@/features/pipeline-editor/components/CatalogPanel.vue'

// Không còn card "Catalog" với 2 tab con: Agents / Skills là 2 mục collapsible
// cùng cấp với Rules, trạng thái mở do PipelineEditor giữ (`openSections`).

const catalog = {
  agents: [
    { id: 'investigator', name: 'investigator', description: 'survey codebase', plugin: 'dev', source: 'repo', skills: ['survey'] },
    { id: 'reviewer', name: 'reviewer', description: 'review diff', plugin: 'dev', source: 'repo', skills: [] },
  ],
  skills: [{ id: 'survey', name: 'survey-codebase', description: 'how to survey', plugin: 'dev', source: 'repo' }],
}

function mountPanel(openSections = new Set(['agents', 'skills'])) {
  return mountWithI18n(CatalogPanel, { props: { catalog, openSections } })
}

describe('CatalogPanel', () => {
  it('renders both Agents and Skills as sibling collapsible sections with counts', () => {
    const w = mountPanel()
    const sections = w.findAll('.editor-section')
    expect(sections).toHaveLength(2)
    expect(sections[0].text()).toContain('Agents')
    expect(sections[1].text()).toContain('Skills')
    // count badge = số item sau filter nguồn
    expect(sections[0].find('.editor-section-count').text()).toBe('2')
    expect(sections[1].find('.editor-section-count').text()).toBe('1')
    expect(w.find('.catalog-tabs').exists()).toBe(false)
  })

  it('renders agents and skills from the catalog', () => {
    const w = mountPanel()
    expect(w.text()).toContain('investigator')
    expect(w.text()).toContain('reviewer')
    expect(w.text()).toContain('survey-codebase')
  })

  it('gives each section its own search box', () => {
    const w = mountPanel()
    expect(w.findAll('.catalog-search')).toHaveLength(2)
  })

  it('open prop drives which section is expanded', () => {
    const w = mountPanel(new Set(['skills']))
    const sections = w.findAll('.editor-section')
    expect((sections[0].element as HTMLDetailsElement).open).toBe(false)
    expect((sections[1].element as HTMLDetailsElement).open).toBe(true)
  })

  it('clicking a section header emits toggle-section with its key', async () => {
    const w = mountPanel()
    await w.findAll('.editor-section-head')[1].trigger('click')
    expect(w.emitted('toggle-section')).toEqual([['skills']])
  })

  it('tolerates an empty catalog without crashing', () => {
    const w = mountWithI18n(CatalogPanel, {
      props: { catalog: { agents: [], skills: [] }, openSections: new Set(['agents', 'skills']) },
    })
    expect(w.text()).toContain('Không có agent nào')
    expect(w.text()).toContain('Không có skill nào')
  })
})
