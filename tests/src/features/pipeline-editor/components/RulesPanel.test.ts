import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountWithI18n, createTestI18n } from '../../../helpers/i18n'
import RulesPanel from '@/features/pipeline-editor/components/RulesPanel.vue'

// RulesPanel calls useI18n() after the pipelineEditor i18n migration, so it must
// mount with the i18n plugin installed (mountWithI18n / createTestI18n).

const rule = { id: 'r1', name: 'doc rule', path: 'rules/doc.md', category: 'doc-writing', scope: 'project' }

const FILTER = '.rules-category-filter'

// 5 rule / 3 category — `categories` là payload của `GET /api/rules` (chỉ những
// category thực có rule, đã sắp theo RULE_CATEGORIES).
const RULES = [
  { id: 'c1', name: 'coding one', path: 'rules/coding-1.md', category: 'coding', scope: 'project' },
  { id: 'c2', name: 'coding two', path: 'rules/coding-2.md', category: 'coding', scope: 'global' },
  { id: 't1', name: 'test one', path: 'rules/test-1.md', category: 'test', scope: 'project' },
  { id: 't2', name: 'test two', path: 'rules/test-2.md', category: 'test', scope: 'project' },
  { id: 'd1', name: 'doc review', path: 'rules/doc-review.md', category: 'doc-review', scope: 'project' },
]
const CATEGORIES = ['coding', 'doc-review', 'test']

function mountRules(props: Record<string, any> = {}) {
  return mountWithI18n(RulesPanel, {
    props: { rules: RULES, categories: CATEGORIES, openSections: new Set(['rules']), ...props },
  })
}

function ruleNames(w: ReturnType<typeof mountRules>) {
  return w.findAll('.rules-item-name').map((n) => n.text())
}

async function pickCategory(w: ReturnType<typeof mountRules>, value: string) {
  await w.find(FILTER).setValue(value)
}

describe('RulesPanel (i18n)', () => {
  it('renders the vi empty state (default locale)', () => {
    const w = mountWithI18n(RulesPanel, { props: { rules: [], openSections: new Set(['rules']) } })
    expect(w.text()).toContain('Không có rule nào')
  })

  it('renders the en translation under the en locale', () => {
    const w = mount(RulesPanel, {
      props: { rules: [], openSections: new Set(['rules']) },
      global: { plugins: [createTestI18n('en')] },
    })
    expect(w.text()).toContain('No rules found')
  })

  it('translates the category filter and the filtered-empty state in both locales', async () => {
    const props = { rules: [rule], categories: ['coding'], openSections: new Set(['rules']) }

    const vi = mountWithI18n(RulesPanel, { props })
    await pickCategory(vi, 'coding')
    expect(vi.find(FILTER).attributes('aria-label')).toBe('Lọc rule theo category')
    expect(vi.findAll(`${FILTER} option`)[0].text()).toBe('Tất cả category')
    expect(vi.find('.rules-empty').text()).toBe('Không có rule nào khớp filter')

    const en = mount(RulesPanel, { props, global: { plugins: [createTestI18n('en')] } })
    await pickCategory(en, 'coding')
    expect(en.find(FILTER).attributes('aria-label')).toBe('Filter rules by category')
    expect(en.findAll(`${FILTER} option`)[0].text()).toBe('All categories')
    expect(en.find('.rules-empty').text()).toBe('No rules match the filter')
  })
})

// c.1 — Rules là một mục collapsible cùng cấp Agents, không còn head tự vẽ.
describe('RulesPanel — mục collapsible', () => {
  it('renders one section titled Rules with the rule count', () => {
    const w = mountWithI18n(RulesPanel, {
      props: { rules: [rule], openSections: new Set(['rules']) },
    })
    const section = w.find('.editor-section')
    expect(section.exists()).toBe(true)
    expect(section.text()).toContain('Rules')
    expect(w.find('.editor-section-count').text()).toBe('1')
    expect(w.find('.rules-panel-head').exists()).toBe(false)
  })

  it('is collapsed when its key is not in openSections', () => {
    const w = mountWithI18n(RulesPanel, { props: { rules: [rule], openSections: new Set() } })
    expect((w.find('.editor-section').element as HTMLDetailsElement).open).toBe(false)
  })

  // Panel chỉ giành chiều cao khi section của nó mở — xem docs/ui-overflow.md.
  it('marks the root panel open only while the rules section is expanded', () => {
    const open = mountWithI18n(RulesPanel, { props: { rules: [rule], openSections: new Set(['rules']) } })
    const closed = mountWithI18n(RulesPanel, { props: { rules: [rule], openSections: new Set() } })
    expect(open.find('.rules-panel--open').exists()).toBe(true)
    expect(closed.find('.rules-panel--open').exists()).toBe(false)
  })

  it('clicking the header emits toggle-section with "rules"', async () => {
    const w = mountWithI18n(RulesPanel, {
      props: { rules: [rule], openSections: new Set(['rules']) },
    })
    await w.find('.editor-section-head').trigger('click')
    expect(w.emitted('toggle-section')).toEqual([['rules']])
  })

  // Rule là phần tử tĩnh sau khi bỏ highlight theo category: bấm vào không làm gì.
  it('renders a rule as a static row that emits nothing when clicked', async () => {
    const w = mountWithI18n(RulesPanel, {
      props: { rules: [rule], openSections: new Set(['rules']) },
    })
    const item = w.find('.rules-item')
    expect(item.text()).toContain('doc rule')
    expect(item.text()).toContain('rules/doc.md')
    await item.trigger('click')
    expect(w.emitted('select-rule')).toBeUndefined()
  })
})

// AC1 — control lọc thuộc về thân mục Rules và lọc đúng danh sách của chính nó.
describe('RulesPanel — filter theo category', () => {
  it('shows every rule under the default "all", with the total in the badge', () => {
    const w = mountRules()
    expect(ruleNames(w)).toEqual(['coding one', 'test one', 'test two', 'doc review', 'coding two'])
    expect(w.find('.editor-section-count').text()).toBe('5')
    expect((w.find(FILTER).element as HTMLSelectElement).value).toBe('all')
  })

  it('picking a category keeps only that category, badge counts after the filter', async () => {
    const w = mountRules()
    await pickCategory(w, 'coding')

    expect(ruleNames(w)).toEqual(['coding one', 'coding two'])
    expect(w.find('.editor-section-count').text()).toBe('2')
  })

  it('picking "all" again restores the full list', async () => {
    const w = mountRules()
    await pickCategory(w, 'coding')
    await pickCategory(w, 'all')

    expect(ruleNames(w)).toEqual(['coding one', 'test one', 'test two', 'doc review', 'coding two'])
    expect(w.find('.editor-section-count').text()).toBe('5')
  })

  // Một-giá-trị, không phải multi-select: lần chọn sau thay lần trước.
  it('replaces the previous category instead of accumulating', async () => {
    const w = mountRules()
    await pickCategory(w, 'coding')
    await pickCategory(w, 'test')

    expect(ruleNames(w)).toEqual(['test one', 'test two'])
  })

  it('offers "all" plus exactly the categories it was given, in that order', () => {
    const w = mountRules()
    const options = w.findAll(`${FILTER} option`)
    expect(options.map((o) => o.attributes('value'))).toEqual(['all', 'coding', 'doc-review', 'test'])
  })

  // So sánh chính xác, không phải chứa chuỗi: 'test' không được kéo theo 'testing'.
  it('matches the category exactly', async () => {
    const w = mountRules({
      rules: [
        { id: 'a', name: 'exact', path: 'a.md', category: 'test', scope: 'project' },
        { id: 'b', name: 'longer', path: 'b.md', category: 'testing', scope: 'project' },
      ],
      categories: ['test', 'testing'],
    })
    await pickCategory(w, 'test')

    expect(ruleNames(w)).toEqual(['exact'])
  })

  it('shows a filtered-empty state distinct from the no-rules state', async () => {
    const w = mountRules({
      rules: [RULES[0]],
      categories: CATEGORIES,
    })
    await pickCategory(w, 'test')

    expect(ruleNames(w)).toEqual([])
    expect(w.find('.rules-empty').text()).toBe('Không có rule nào khớp filter')
    expect(w.find('.editor-section-count').text()).toBe('0')
  })

  it('does not render the toolbar when there is no category to pick', () => {
    const w = mountRules({ rules: [], categories: [] })
    expect(w.find('.rules-toolbar').exists()).toBe(false)
    expect(w.find('.rules-empty').text()).toBe('Không có rule nào')
  })

  // `loadRules()` là async — categories về sau khi mount, mặc định 'all' vẫn hợp lệ.
  it('works when categories arrive after mount', async () => {
    const w = mountRules({ rules: [], categories: [] })
    await w.setProps({ rules: RULES, categories: CATEGORIES })

    expect((w.find(FILTER).element as HTMLSelectElement).value).toBe('all')
    expect(ruleNames(w)).toHaveLength(5)
  })

  // Đổi project -> category đang chọn không còn trong option -> rơi về 'all' thay
  // vì để select trắng.
  it('falls back to "all" when the picked category disappears', async () => {
    const w = mountRules()
    await pickCategory(w, 'doc-review')
    expect(ruleNames(w)).toEqual(['doc review'])

    await w.setProps({
      rules: RULES.filter((r) => r.category !== 'doc-review'),
      categories: ['coding', 'test'],
    })

    expect((w.find(FILTER).element as HTMLSelectElement).value).toBe('all')
    expect(ruleNames(w)).toHaveLength(4)
  })

  // Nguyên nhân gốc của bug: control lọc từng đứng ngoài mục nó phục vụ.
  it('keeps the filter inside the Rules section body', () => {
    const w = mountRules()
    expect(w.find(`.editor-section-body ${FILTER}`).exists()).toBe(true)
    expect(w.find(`.rules-panel > ${FILTER}`).exists()).toBe(false)
  })
})
