import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountWithI18n } from '../../../helpers/i18n'
import CatalogPanel from '@/features/pipeline-editor/components/CatalogPanel.vue'

// Catalog có 2 mục cùng cấp: Agents (kéo được vào canvas) và Skills (danh sách
// tra cứu). Mỗi mục có select lọc nguồn riêng, đặt trong thân của chính nó —
// state độc lập nên lọc mục này không đổi mục kia.
// Trạng thái mở do PipelineEditor giữ (`openSections`), dùng chung với RulesPanel.

const catalog = {
  agents: [
    { id: 'investigator', name: 'investigator', description: 'survey codebase', plugin: 'dev', source: 'repo:dev', skills: ['survey'] },
    { id: 'reviewer', name: 'reviewer', description: 'review diff', plugin: 'dev', source: 'repo:dev', skills: [] },
    { id: 'custom', name: 'custom-agent', description: 'made in dashboard', plugin: '', source: 'dashboard', skills: [] },
  ],
  skills: [
    { id: 'survey', name: 'survey-codebase', description: 'how to survey', plugin: 'dev', source: 'repo:dev' },
    { id: 'write-tests', name: 'write-tests', description: 'how to test', plugin: 'dev', source: 'repo:dev' },
    { id: 'my-skill', name: 'my-custom-skill-xyz', description: '', plugin: '', source: 'dashboard' },
  ],
}

const ALL_OPEN = new Set(['agents', 'skills'])

function mountPanel(openSections: Set<string> = new Set(['agents'])) {
  return mountWithI18n(CatalogPanel, { props: { catalog, openSections } })
}

/** Section 0 = Agents, section 1 = Skills (thứ tự Agents -> Skills là hợp đồng UI). */
function section(w: ReturnType<typeof mountPanel>, index: number) {
  return w.findAll('.editor-section')[index]
}

function itemNames(w: ReturnType<typeof mountPanel>, index: number) {
  return section(w, index).findAll('.catalog-item-name').map((n) => n.text())
}

function countBadge(w: ReturnType<typeof mountPanel>, index: number) {
  return section(w, index).find('.editor-section-count').text()
}

async function pickSource(w: ReturnType<typeof mountPanel>, index: number, value: string) {
  await section(w, index).find('.catalog-source-filter').setValue(value)
}

describe('CatalogPanel', () => {
  it('renders the skills catalog again as its own section', () => {
    const w = mountPanel(ALL_OPEN)
    const sections = w.findAll('.editor-section')
    expect(sections).toHaveLength(2)
    expect(sections[0].text()).toContain('Agents')
    expect(sections[1].text()).toContain('Skills')
    expect(w.text()).toContain('survey-codebase')
    expect(w.findAll('.catalog-search')).toHaveLength(2)
    expect(w.find('.catalog-tabs').exists()).toBe(false)
  })

  it('renders agents from the catalog', () => {
    const w = mountPanel()
    expect(w.text()).toContain('investigator')
    expect(w.text()).toContain('reviewer')
  })

  // Danh sách skills đọc thẳng `catalog.skills` — tên/mô tả nào cũng hiện, kể cả
  // tên chưa từng có trong sản phẩm (chốt "không hardcode").
  it('renders every skill from the catalog with its description', () => {
    const w = mountPanel(ALL_OPEN)
    expect(itemNames(w, 1)).toEqual(['survey-codebase', 'write-tests', 'my-custom-skill-xyz'])
    expect(section(w, 1).text()).toContain('how to survey')
    expect(countBadge(w, 1)).toBe('3')
  })

  // Skill thiếu mô tả: không dựng dòng rỗng, không lộ undefined/null.
  it('omits the description row for a skill without one', () => {
    const w = mountPanel(ALL_OPEN)
    expect(section(w, 1).findAll('.catalog-item-desc')).toHaveLength(2)
    expect(section(w, 1).text()).not.toContain('undefined')
  })

  it('the agents source filter filters the agents list', async () => {
    const w = mountPanel(ALL_OPEN)
    await pickSource(w, 0, 'dashboard')

    expect(itemNames(w, 0)).toEqual(['custom-agent'])
    expect(countBadge(w, 0)).toBe('1')
  })

  it('picking "all" again resets the agents list', async () => {
    const w = mountPanel(ALL_OPEN)
    await pickSource(w, 0, 'dashboard')
    await pickSource(w, 0, 'all')

    expect(itemNames(w, 0)).toEqual(['investigator', 'reviewer', 'custom-agent'])
    expect(countBadge(w, 0)).toBe('3')
  })

  it('the skills source filter filters skills without touching agents', async () => {
    const w = mountPanel(ALL_OPEN)
    await pickSource(w, 1, 'dashboard')

    expect(itemNames(w, 1)).toEqual(['my-custom-skill-xyz'])
    expect(countBadge(w, 1)).toBe('1')
    expect(itemNames(w, 0)).toEqual(['investigator', 'reviewer', 'custom-agent'])
    expect(countBadge(w, 0)).toBe('3')
  })

  // Option chỉ liệt nguồn thực có: không để chọn một giá trị rồi danh sách rỗng.
  it('only offers source options present in the catalog', () => {
    const w = mountPanel(ALL_OPEN)
    const values = section(w, 0).findAll('.catalog-source-filter option').map((o) => o.attributes('value'))
    expect(values).toEqual(['all', 'repo', 'dashboard'])
  })

  // Option sinh từ danh sách thô — chọn một nguồn không được làm tập option co lại.
  it('keeps the full option set after a source is picked', async () => {
    const w = mountPanel(ALL_OPEN)
    await pickSource(w, 0, 'dashboard')

    const values = section(w, 0).findAll('.catalog-source-filter option').map((o) => o.attributes('value'))
    expect(values).toEqual(['all', 'repo', 'dashboard'])
  })

  it('falls back to "all" when the picked source disappears from the catalog', async () => {
    const w = mountPanel(ALL_OPEN)
    await pickSource(w, 0, 'dashboard')
    expect(itemNames(w, 0)).toEqual(['custom-agent'])

    await w.setProps({
      catalog: { agents: catalog.agents.filter((a) => a.source !== 'dashboard'), skills: catalog.skills },
    })

    expect(itemNames(w, 0)).toEqual(['investigator', 'reviewer'])
    expect(countBadge(w, 0)).toBe('2')
  })

  it('marks skill items as static so they cannot be dragged onto the canvas', () => {
    const w = mountPanel(ALL_OPEN)
    const items = section(w, 1).findAll('.catalog-item')
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.attributes('draggable')).toBeUndefined()
      expect(item.classes()).toContain('catalog-item--static')
    }
  })

  it('keeps agents draggable — no regression from the new skills section', () => {
    const w = mountPanel()
    expect(section(w, 0).find('.catalog-item').attributes('draggable')).toBe('true')
  })

  it('open prop drives whether each section is expanded', () => {
    const w = mountPanel(new Set())
    const sections = w.findAll('.editor-section')
    expect(sections.map((s) => (s.element as HTMLDetailsElement).open)).toEqual([false, false])
  })

  // Panel chỉ giành chiều cao khi một section của nó mở — xem docs/ui-overflow.md.
  it('marks the root panel open while either of its sections is expanded', () => {
    expect(mountPanel().find('.catalog-panel--open').exists()).toBe(true)
    expect(mountPanel(new Set(['skills'])).find('.catalog-panel--open').exists()).toBe(true)
    expect(mountPanel(new Set()).find('.catalog-panel--open').exists()).toBe(false)
  })

  // Cột trái chia chiều cao theo SỐ MỤC ĐANG MỞ, không theo số panel: panel này
  // gói 2 mục còn RulesPanel chỉ có 1, chia theo panel thì mỗi mục catalog chỉ
  // được nửa phần của Rules (vùng cuộn sụp còn vài px ở viewport thấp).
  it('claims a share of the column per open section', () => {
    expect(mountPanel().find('.catalog-panel').attributes('style')).toBeUndefined()
    expect(mountPanel(ALL_OPEN).find('.catalog-panel').attributes('style')).toContain(
      'flex-grow: 2',
    )
  })

  // Ô tìm phải nối vào danh sách ĐÃ lọc nguồn, không phải danh sách thô.
  it('searches within the source-filtered skills list', async () => {
    vi.useFakeTimers()
    try {
      const w = mountPanel(ALL_OPEN)
      await section(w, 1).find('.catalog-search').setValue('skill')
      vi.advanceTimersByTime(200)
      await nextTick()
      expect(itemNames(w, 1)).toEqual(['my-custom-skill-xyz'])

      await section(w, 1).find('.catalog-search').setValue('survey')
      vi.advanceTimersByTime(200)
      await nextTick()
      expect(itemNames(w, 1)).toEqual(['survey-codebase'])

      // Lọc nguồn 'dashboard' bỏ 'survey-codebase' -> tìm 'survey' không còn kết quả.
      await pickSource(w, 1, 'dashboard')
      vi.advanceTimersByTime(200)
      await nextTick()
      expect(itemNames(w, 1)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('clicking a section header emits toggle-section with its key', async () => {
    const w = mountPanel(ALL_OPEN)
    await section(w, 0).find('.editor-section-head').trigger('click')
    await section(w, 1).find('.editor-section-head').trigger('click')
    expect(w.emitted('toggle-section')).toEqual([['agents'], ['skills']])
  })

  it('tolerates an empty catalog without crashing', () => {
    const w = mountWithI18n(CatalogPanel, {
      props: { catalog: { agents: [], skills: [] }, openSections: ALL_OPEN },
    })
    expect(w.text()).toContain('Không có agent nào')
    expect(w.text()).toContain('Không có skill nào')
    expect(w.findAll('.catalog-item')).toHaveLength(0)
  })
})
