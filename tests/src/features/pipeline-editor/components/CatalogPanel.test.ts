import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CatalogPanel from '@/features/pipeline-editor/components/CatalogPanel.vue'

const catalog = {
  agents: [
    { id: 'investigator', name: 'investigator', description: 'survey codebase', plugin: 'dev', source: 'repo', skills: ['survey'] },
    { id: 'reviewer', name: 'reviewer', description: 'review diff', plugin: 'dev', source: 'repo', skills: [] },
  ],
  skills: [{ id: 'survey', name: 'survey-codebase', description: 'how to survey', plugin: 'dev', source: 'repo' }],
}

describe('CatalogPanel', () => {
  it('renders agents from the catalog by default', () => {
    const w = mount(CatalogPanel, { props: { catalog } })
    expect(w.text()).toContain('investigator')
    expect(w.text()).toContain('reviewer')
  })

  it('tolerates an empty catalog without crashing', () => {
    const w = mount(CatalogPanel, { props: { catalog: { agents: [], skills: [] } } })
    expect(w.text()).toContain('No agents found')
  })
})
