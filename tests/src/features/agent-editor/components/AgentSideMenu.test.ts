import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it } from 'vitest'
import AgentSideMenu from '@/features/agent-editor/components/AgentSideMenu.vue'
import type { AgentMeta } from '@/features/agent-editor/scripts/agentEditorApi'

const AGENTS: AgentMeta[] = [
  { name: 'alpha', scope: 'project', model: 'claude-opus-5', editable: true },
  { name: 'beta', scope: 'project', editable: false },
  { name: 'gamma', scope: 'global', editable: true },
]

function mountMenu(props: Partial<Record<string, unknown>> = {}) {
  return mount(AgentSideMenu, {
    props: { agents: AGENTS, selectedKey: null, busyKey: null, canExport: false, ...props },
  })
}

const rowActions = (w: ReturnType<typeof mountMenu>, i: number) =>
  w.findAll('.agent-list-item')[i].findAll('.icon-btn')

describe('AgentSideMenu — cụm nút phần trên (TC-06, TC-10, TC-11)', () => {
  it('render đủ 4 nút chức năng', () => {
    const labels = mountMenu().findAll('.agent-side-actions button').map((b) => b.text())
    expect(labels).toEqual(['+ Agent mới', 'Template / Sao chép', 'Tạo từ mô tả', 'Export'])
  })

  it.each([
    [0, 'new'],
    [1, 'templates'],
    [2, 'nl'],
  ])('nút thứ %i phát event %s', async (index, event) => {
    const w = mountMenu()
    await w.findAll('.agent-side-actions button')[index].trigger('click')
    expect(w.emitted(event)).toHaveLength(1)
  })

  // qa.md Q1 → A: chưa chọn agent thì Export disabled + tooltip giải thích.
  it('canExport=false ⇒ Export disabled kèm tooltip, không phát event', async () => {
    const w = mountMenu({ canExport: false })
    const btn = w.findAll('.agent-side-actions button')[3]
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toBe('Chọn một agent trước khi export')
    await btn.trigger('click')
    expect(w.emitted('export')).toBeUndefined()
  })

  it('canExport=true ⇒ Export bấm được, không còn tooltip cảnh báo', async () => {
    const w = mountMenu({ canExport: true })
    const btn = w.findAll('.agent-side-actions button')[3]
    expect(btn.attributes('disabled')).toBeUndefined()
    expect(btn.attributes('title')).toBeUndefined()
    await btn.trigger('click')
    expect(w.emitted('export')).toHaveLength(1)
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

  // TC-14: danh sách rỗng ⇒ empty state tường minh, cụm nút vẫn còn.
  it('danh sách rỗng ⇒ empty state, cụm 4 nút không bị ẩn theo', () => {
    const w = mountMenu({ agents: [] })
    expect(w.findAll('.agent-group')).toHaveLength(0)
    expect(w.find('.agent-list-empty').text()).toBe('Chưa có agent tùy chỉnh')
    expect(w.findAll('.agent-side-actions button')).toHaveLength(4)
  })
})

describe('AgentSideMenu — 3 action mỗi dòng (TC-15, TC-16, TC-17, TC-18)', () => {
  it('dòng editable có đủ xem / sửa / xoá, mỗi nút có title + aria-label', () => {
    const actions = rowActions(mountMenu(), 0)
    expect(actions).toHaveLength(3)
    expect(actions.map((a) => a.attributes('aria-label'))).toEqual([
      'Xem nội dung',
      'Chỉnh sửa agent',
      'Xóa agent',
    ])
    for (const a of actions) expect(a.attributes('title')).toBe(a.attributes('aria-label'))
  })

  it('nút xoá mang biểu diễn danger', () => {
    expect(rowActions(mountMenu(), 0)[2].classes()).toContain('danger')
  })

  it.each([
    [0, 'view', 'alpha'],
    [1, 'edit', 'alpha'],
    [2, 'delete', 'alpha'],
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

  // E4: agent không sửa được thì giấu bút chì, vẫn xem và xoá được.
  it('editable=false ⇒ ẩn nút sửa, giữ xem + xoá', () => {
    const actions = rowActions(mountMenu(), 1)
    expect(actions).toHaveLength(2)
    expect(actions.map((a) => a.attributes('aria-label'))).toEqual(['Xem nội dung', 'Xóa agent'])
  })

  // E3: chặn double-click xoá.
  it('busyKey khớp dòng ⇒ nút xoá disabled, chỉ dòng đó', () => {
    const w = mountMenu({ busyKey: 'project:alpha' })
    expect(rowActions(w, 0)[2].attributes('disabled')).toBeDefined()
    expect(rowActions(w, 2)[1].attributes('disabled')).toBeUndefined()
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
