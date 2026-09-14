import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it } from 'vitest'
import KnowledgeSideMenu from '@/features/knowledge/components/KnowledgeSideMenu.vue'

/**
 * Cột trái: cụm icon action + tab scope + ô tìm (neo cố định), dưới là 3 nhóm
 * `<details>` — tài liệu · collection · tag.
 *
 * Thuần trình bày: mọi thao tác đi lên panel qua emit, component này 🚫 không
 * gọi API nên không phải mock gì.
 */

const ENTRY = { id: 'project/a', slug: 'a', scope: 'project', title: 'Alpha', tags: ['x'] }
const COLLECTION = { id: 'nhom-a', name: 'Nhóm A', scope: 'project', entryCount: 0, tags: [] }
const TAG = { tag: 'x', count: 1, color: 'blue', description: '', scope: 'project' }

const BASE = {
  entries: [ENTRY],
  loading: false,
  collections: [COLLECTION],
  collectionsError: '',
  activeCollection: '',
  tags: [TAG],
  tagFilter: [] as string[],
  viewingId: null,
  busyId: null,
  scope: 'project',
  query: '',
}

const mountMenu = (props: Record<string, unknown> = {}) =>
  mount(KnowledgeSideMenu, { props: { ...BASE, ...props } })

const groups = (w: ReturnType<typeof mountMenu>) => w.findAll('.knowledge-group')

describe('KnowledgeSideMenu — ba nhóm collapse', () => {
  it('render đủ 3 nhóm kèm số đếm', () => {
    const labels = groups(mountMenu()).map((g) => g.find('summary').text())
    expect(labels[0]).toContain('Tài liệu')
    expect(labels[1]).toContain('Collection')
    expect(labels[2]).toContain('Tag')
  })

  /**
   * E9 — từ khi collection/tag lên DB, nhóm **rỗng** là trạng thái hợp lệ:
   * hiện kèm `0`, 🚫 không lọc mất (khác `AgentSideMenu` vốn giấu nhóm rỗng).
   */
  it('nhóm rỗng vẫn render, kèm số đếm 0 và thông điệp rỗng', () => {
    const w = mountMenu({ collections: [], tags: [] })
    expect(groups(w)).toHaveLength(3)
    expect(groups(w)[1].find('summary').text()).toContain('(0)')
    expect(groups(w)[1].text()).toContain('Chưa có collection')
    expect(groups(w)[2].text()).toContain('Chưa có tag')
  })

  /** E2 — nhóm rỗng phải nói rõ có lệnh migrate, đừng để đọc nhầm thành mất dữ liệu. */
  it('nhóm collection rỗng nhắc lệnh migrate', () => {
    expect(mountMenu({ collections: [] }).text()).toContain('migrate-knowledge-to-sqlite')
  })

  it('chỉ nhóm Tài liệu mở sẵn — hai nhóm kia gập để cả ba cùng lọt màn hình', () => {
    const open = groups(mountMenu()).map((g) => g.attributes('open') !== undefined)
    expect(open).toEqual([true, false, false])
  })
})

describe('KnowledgeSideMenu — cụm icon action', () => {
  it('upload · download · tạo mới là icon button có title + aria-label', () => {
    const btns = mountMenu().findAll('.knowledge-side-actions .icon-btn')
    expect(btns).toHaveLength(3)
    for (const b of btns) {
      expect(b.attributes('title')).toBeTruthy()
      expect(b.attributes('aria-label')).toBeTruthy()
      expect(b.attributes('type')).toBe('button')
      expect(b.text()).toBe('') // icon-only, không nhãn chữ
    }
  })

  it('phát đúng sự kiện cho từng nút', async () => {
    const w = mountMenu()
    const btns = w.findAll('.knowledge-side-actions .icon-btn')
    await btns[0].trigger('click')
    await btns[1].trigger('click')
    await btns[2].trigger('click')
    expect(Object.keys(w.emitted())).toEqual(expect.arrayContaining(['upload', 'download', 'new']))
  })

  /** E11 — danh sách lọc rỗng thì không có gì để tải; nút phải nói rõ lý do. */
  it('danh sách rỗng ⇒ nút download disabled kèm title giải thích', () => {
    const w = mountMenu({ entries: [] })
    const download = w.findAll('.knowledge-side-actions .icon-btn')[1]
    expect(download.attributes('disabled')).toBeDefined()
    expect(download.attributes('title')).toContain('Không có entry')
  })
})

describe('KnowledgeSideMenu — hàng tài liệu', () => {
  it('4 icon theo đúng thứ tự xem · sửa · tải · xoá, xoá đứng CUỐI', () => {
    const icons = groups(mountMenu())[0].findAll('.knowledge-list-item .icon-btn')
    expect(icons.map((b) => b.attributes('aria-label'))).toEqual([
      'Xem nội dung',
      'Chỉnh sửa entry',
      'Tải entry này (.md)',
      'Xoá entry',
    ])
    // Action phá huỷ mang `.danger`, không đứng lẫn với action thường.
    expect(icons[3].classes()).toContain('danger')
  })

  it('mỗi icon phát đúng sự kiện kèm id', async () => {
    const w = mountMenu()
    const icons = groups(w)[0].findAll('.knowledge-list-item .icon-btn')
    for (const i of [0, 1, 2, 3]) await icons[i].trigger('click')

    expect(w.emitted('view')?.[0]).toEqual(['project/a'])
    expect(w.emitted('edit')?.[0]).toEqual(['project/a'])
    expect(w.emitted('download-entry')?.[0]).toEqual(['project/a'])
    expect(w.emitted('delete')?.[0]).toEqual(['project/a'])
  })

  it('dòng đang xoá dở khoá nút xoá, chặn double-click', () => {
    const w = mountMenu({ busyId: 'project/a' })
    const icons = groups(w)[0].findAll('.knowledge-list-item .icon-btn')
    expect(icons[3].attributes('disabled')).toBeDefined()
  })

  it('đang tải thì hiện thông điệp loading thay cho danh sách', () => {
    const w = mountMenu({ loading: true, entries: [] })
    expect(groups(w)[0].text()).toContain('Đang tải')
  })
})

describe('KnowledgeSideMenu — nút `+` trong <summary>', () => {
  /**
   * ⚠️ `<button>` trong `<summary>` mặc định VẪN toggle `<details>`. Thiếu
   * `.stop.prevent` thì bấm `+` vừa mở dialog vừa gập nhóm.
   */
  it('bấm `+` phát sự kiện mà KHÔNG gập/mở nhóm', async () => {
    const w = mountMenu()
    const group = groups(w)[1]
    const before = group.attributes('open')

    await group.find('.knowledge-group-add').trigger('click')

    expect(w.emitted('new-collection')).toHaveLength(1)
    expect(groups(w)[1].attributes('open')).toBe(before)
  })

  it('nhóm Tag cũng vậy', async () => {
    const w = mountMenu()
    const group = groups(w)[2]
    const before = group.attributes('open')

    await group.find('.knowledge-group-add').trigger('click')

    expect(w.emitted('new-tag')).toHaveLength(1)
    expect(groups(w)[2].attributes('open')).toBe(before)
  })

  it('lỗi đọc DB ⇒ khoá `+` và mọi nút ghi của hai nhóm', () => {
    const w = mountMenu({ collectionsError: 'không mở được dashboard.sqlite' })
    expect(w.find('.knowledge-side-error').text()).toContain('dashboard.sqlite')
    for (const b of w.findAll('.knowledge-group-add')) expect(b.attributes('disabled')).toBeDefined()
    for (const b of groups(w)[1].findAll('.knowledge-list-item .icon-btn')) {
      expect(b.attributes('disabled')).toBeDefined()
    }
  })
})

describe('KnowledgeSideMenu — collection & tag', () => {
  it('hàng collection hiện số entry + scope, bấm tên thì chọn nhóm', async () => {
    const w = mountMenu()
    const row = groups(w)[1].find('.knowledge-list-item')
    expect(row.text()).toContain('Nhóm A')
    expect(row.text()).toContain('0')
    await row.find('.knowledge-list-name').trigger('click')
    expect(w.emitted('select-collection')?.[0]).toEqual(['nhom-a'])
  })

  it('nhóm đang chọn được đánh dấu active', () => {
    const w = mountMenu({ activeCollection: 'nhom-a' })
    expect(groups(w)[1].find('.knowledge-list-item').classes()).toContain('active')
  })

  it('chip tag mang biến màu inline theo token trong DB', () => {
    const chip = groups(mountMenu())[2].find('.chip-tag')
    expect(chip.attributes('style')).toContain('--tag-c: var(--tag-blue)')
    expect(chip.attributes('style')).toContain('--tag-c-rgb: var(--tag-blue-rgb)')
  })

  it('bấm chip tag bật/tắt filter; tag đang lọc được đánh dấu', async () => {
    const w = mountMenu({ tagFilter: ['x'] })
    expect(groups(w)[2].find('.chip-tag').classes()).toContain('active')
    await groups(w)[2].find('.knowledge-tag-name').trigger('click')
    expect(w.emitted('toggle-tag')?.[0]).toEqual(['x'])
  })

  it('tag count 0 vẫn render (tag chưa entry nào gắn)', () => {
    const w = mountMenu({ tags: [{ ...TAG, count: 0 }] })
    expect(groups(w)[2].findAll('.knowledge-list-item')).toHaveLength(1)
    expect(groups(w)[2].text()).toContain('(0)')
  })
})

describe('KnowledgeSideMenu — tab scope + ô tìm', () => {
  it('3 tab scope, tab đang chọn có class active', () => {
    const tabs = mountMenu().findAll('.knowledge-scope-tab')
    expect(tabs.map((t) => t.text())).toEqual(['Project', 'System', 'Global'])
    expect(tabs[0].classes()).toContain('active')
  })

  it('bấm tab khác phát update:scope', async () => {
    const w = mountMenu()
    await w.findAll('.knowledge-scope-tab')[2].trigger('click')
    expect(w.emitted('update:scope')?.[0]).toEqual(['global'])
  })

  it('gõ vào ô tìm phát update:query', async () => {
    const w = mountMenu()
    await w.find('.knowledge-side-filters input').setValue('abc')
    expect(w.emitted('update:query')?.[0]).toEqual(['abc'])
  })
})
