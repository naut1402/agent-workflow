import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it, vi } from 'vitest'
import AgentSideMenu from '@/features/agent-editor/components/AgentSideMenu.vue'
import type { AgentMeta } from '@/features/agent-editor/scripts/agentEditorApi'

const AGENTS: AgentMeta[] = [
  { name: 'alpha', scope: 'project', model: 'claude-opus-5', editable: true },
  { name: 'beta', scope: 'project', editable: false },
  { name: 'gamma', scope: 'global', editable: true },
]

function mountMenu(props: Partial<Record<string, unknown>> = {}) {
  return mount(AgentSideMenu, {
    props: { agents: AGENTS, selectedKey: null, busyKey: null, ...props },
  })
}

const rowActions = (w: ReturnType<typeof mountMenu>, i: number) =>
  w.findAll('.agent-list-item')[i].findAll('.icon-btn')

// TC-A1/TC-A3/TC-C1: toolbar dọn sạch, chỉ còn "Agent mới" + icon-button Upload.
describe('AgentSideMenu — toolbar (TC-A1, TC-A3, TC-C1)', () => {
  it('chỉ còn đúng 2 điều khiển: "Agent mới" (nút chữ) + Upload (icon-button)', () => {
    const w = mountMenu()
    const controls = w.findAll('.agent-side-actions > *')
    // input file ẩn không tính là điều khiển hiển thị.
    const visible = controls.filter((c) => c.element.tagName.toLowerCase() === 'button')
    expect(visible).toHaveLength(2)
    expect(visible[0].text()).toBe('+ Agent mới')
    expect(visible[0].classes()).not.toContain('icon-btn')
  })

  it('không còn nút/label "Template / Sao chép", "Tạo từ mô tả", "Export", "Download" ở toolbar', () => {
    const texts = mountMenu()
      .findAll('.agent-side-actions button')
      .map((b) => b.text())
    for (const forbidden of ['Template / Sao chép', 'Tạo từ mô tả', 'Export', 'Download']) {
      expect(texts.join(' | ')).not.toContain(forbidden)
    }
  })

  it('nút Upload là icon-button: không có text label, có title + aria-label, cùng class icon-btn', () => {
    const btn = mountMenu().findAll('.agent-side-actions button')[1]
    expect(btn.text()).toBe('')
    expect(btn.classes()).toContain('icon-btn')
    expect(btn.attributes('title')).toBe('Upload agent')
    expect(btn.attributes('aria-label')).toBe('Upload agent')
    expect(btn.find('svg').exists()).toBe(true)
  })

  it('bấm icon Upload ⇒ kích hoạt input file ẩn (giữ nguyên hành vi upload)', async () => {
    const w = mountMenu()
    const input = w.find('input[type="file"]')
    expect(input.attributes('hidden')).toBeDefined()
    expect(input.attributes('accept')).toBe('.md')
    const clickSpy = vi.spyOn(input.element as HTMLInputElement, 'click')
    await w.findAll('.agent-side-actions button')[1].trigger('click')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('input file thay đổi ⇒ phát event upload-file kèm nguyên event gốc', async () => {
    const w = mountMenu()
    await w.find('input[type="file"]').trigger('change')
    expect(w.emitted('upload-file')).toHaveLength(1)
  })
})

describe('AgentSideMenu — nhóm theo scope (TC-12, TC-14)', () => {
  it('gom agent thành 2 nhóm theo scope, kèm số lượng', () => {
    const groups = mountMenu().findAll('.agent-group')
    expect(groups).toHaveLength(2)
    expect(groups[0].find('summary').text()).toContain('Agent của project')
    expect(groups[0].find('summary').text()).toContain('(2)')
    expect(groups[1].find('summary').text()).toContain('Agent toàn cục')
    expect(groups[1].find('summary').text()).toContain('(1)')
  })

  it('nhóm mặc định mở', () => {
    for (const g of mountMenu().findAll('.agent-group')) {
      expect(g.attributes('open')).toBeDefined()
    }
  })

  // E5: nhóm rỗng không render <details> trống.
  it('scope không có agent nào thì không render nhóm đó', () => {
    const w = mountMenu({ agents: AGENTS.filter((a) => a.scope === 'project') })
    const groups = w.findAll('.agent-group')
    expect(groups).toHaveLength(1)
    expect(groups[0].find('summary').text()).toContain('Agent của project')
  })

  // TC-14: danh sách rỗng ⇒ empty state tường minh, toolbar vẫn còn.
  it('danh sách rỗng ⇒ empty state, toolbar không bị ẩn theo', () => {
    const w = mountMenu({ agents: [] })
    expect(w.findAll('.agent-group')).toHaveLength(0)
    expect(w.find('.agent-list-empty').text()).toBe('Chưa có agent tùy chỉnh')
    expect(w.findAll('.agent-side-actions button')).toHaveLength(2)
  })
})

// TC-B1, TC-B4, TC-D1, TC-D4: mỗi item có icon-button download + duplicate,
// hiển thị bất kể editable, khác biệt icon với nhau và với view/edit/delete.
describe('AgentSideMenu — icon-button mỗi dòng (TC-B1, TC-B4, TC-D1, TC-D4, TC-15..18)', () => {
  it('dòng editable có đủ 5 icon-button: download, sao chép, xem, sửa, xoá — mỗi nút có title + aria-label riêng', () => {
    const actions = rowActions(mountMenu(), 0)
    expect(actions).toHaveLength(5)
    expect(actions.map((a) => a.attributes('aria-label'))).toEqual([
      'Download agent',
      'Sao chép agent',
      'Xem nội dung',
      'Chỉnh sửa agent',
      'Xóa agent',
    ])
    for (const a of actions) expect(a.attributes('title')).toBe(a.attributes('aria-label'))
  })

  it('dòng không editable vẫn có download + sao chép, chỉ ẩn nút sửa', () => {
    const actions = rowActions(mountMenu(), 1)
    expect(actions).toHaveLength(4)
    expect(actions.map((a) => a.attributes('aria-label'))).toEqual([
      'Download agent',
      'Sao chép agent',
      'Xem nội dung',
      'Xóa agent',
    ])
  })

  it('icon download và icon sao chép dùng icon khác nhau, cùng class icon-btn icon-btn-inline như xem/sửa/xoá', () => {
    const actions = rowActions(mountMenu(), 0)
    const download = actions[0]
    const duplicate = actions[1]
    expect(download.find('svg').exists()).toBe(true)
    expect(download.classes()).toEqual(expect.arrayContaining(['icon-btn', 'icon-btn-inline']))
    expect(duplicate.classes()).toEqual(expect.arrayContaining(['icon-btn', 'icon-btn-inline']))
    // Hai icon khác nhau ⇒ nội dung svg (path) không trùng nhau.
    expect(download.find('svg').html()).not.toBe(duplicate.find('svg').html())
  })

  it('nút xoá mang biểu diễn danger', () => {
    expect(rowActions(mountMenu(), 0)[4].classes()).toContain('danger')
  })

  it.each([
    [0, 'download', 'alpha'],
    [1, 'duplicate', 'alpha'],
    [2, 'view', 'alpha'],
    [3, 'edit', 'alpha'],
    [4, 'delete', 'alpha'],
  ])('icon thứ %i phát %s kèm đúng agent', async (index, event, name) => {
    const w = mountMenu()
    await rowActions(w, 0)[index].trigger('click')
    expect((w.emitted(event) as unknown[][])[0][0]).toMatchObject({ name, scope: 'project' })
  })

  // Cả tên agent cũng là nút xem — click tên = click eye.
  it('click tên agent phát view', async () => {
    const w = mountMenu()
    await w.findAll('.agent-list-name')[0].trigger('click')
    expect((w.emitted('view') as unknown[][])[0][0]).toMatchObject({ name: 'alpha' })
  })

  // E3: chặn double-click xoá — nút xoá luôn ở cuối, index phụ thuộc editable.
  it('busyKey khớp dòng ⇒ nút xoá disabled, chỉ dòng đó', () => {
    const w = mountMenu({ busyKey: 'project:alpha' })
    expect(rowActions(w, 0).at(-1)?.attributes('disabled')).toBeDefined()
    expect(rowActions(w, 2).at(-1)?.attributes('disabled')).toBeUndefined()
  })

  it('selectedKey đánh dấu đúng dòng đang xem', () => {
    const items = mountMenu({ selectedKey: 'global:gamma' }).findAll('.agent-list-item')
    expect(items.map((i) => i.classes().includes('active'))).toEqual([false, false, true])
  })

  // TC-21: tên dài phải tra được đầy đủ qua tooltip.
  it('tên agent có title để tra tên đầy đủ khi bị cắt', () => {
    const w = mountMenu({ agents: [{ name: 'x'.repeat(80), scope: 'project' }] })
    expect(w.find('.agent-list-name').attributes('title')).toBe('x'.repeat(80))
  })

  it('chip model chỉ hiện khi agent khai model', () => {
    const items = mountMenu().findAll('.agent-list-item')
    expect(items[0].find('.chip').text()).toBe('claude-opus-5')
    expect(items[1].find('.chip').exists()).toBe(false)
  })
})
