import { mountWithI18n as mount } from '../../../helpers/i18n'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AgentMarkdownView from '@/features/agent-editor/components/AgentMarkdownView.vue'

// mermaid không chạy được trong jsdom; parseMarkdown giữ nguyên bản thật để còn
// chấm được việc frontmatter ra khối code và markdown thật sự được render.
vi.mock('@/frontend/lib/markdownLib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/frontend/lib/markdownLib')>()),
  renderMermaid: vi.fn(async () => {}),
}))

const CONTENT = `---
name: reviewer
---

## Role

Xem xét **code**.

## Skills

| a | b |
|---|---|
| 1 | 2 |

## Workflow

- b1
`

const mountView = (content = CONTENT, name = 'reviewer') =>
  mount(AgentMarkdownView, { props: { name, content } })

describe('AgentMarkdownView — render markdown (TC-27)', () => {
  it('render markdown thật, không đổ text thô', () => {
    const html = mountView().html()
    expect(html).toContain('<h2')
    expect(html).toContain('<strong>code</strong>')
    expect(html).toContain('<table')
  })

  // TC-27: frontmatter phải phân biệt được với thân tài liệu, không thành <hr>.
  it('frontmatter thành block Metadata dạng khối code, không phải <hr>', () => {
    const w = mountView()
    const first = w.findAll('.block-item')[0]
    expect(first.find('summary').text()).toBe('Metadata')
    expect(first.find('pre code').text()).toContain('name: reviewer')
    expect(first.html()).not.toContain('<hr')
  })

  it('mỗi heading ## thành một block, nhãn là tiêu đề section', () => {
    const labels = mountView().findAll('.block-item summary').map((s) => s.text())
    expect(labels).toEqual(['Metadata', 'Role', 'Skills', 'Workflow'])
  })

  it('section không có tiêu đề nhận nhãn mặc định', () => {
    const w = mountView('văn bản phẳng', 'flat')
    expect(w.find('.block-item summary').text()).toBe('Phần không tiêu đề')
  })
})

describe('AgentMarkdownView — toggle block ↔ full (TC-28, E10)', () => {
  it('mặc định ở chế độ block', () => {
    expect(mountView().find('.block-list').exists()).toBe(true)
  })

  it('bấm toggle chuyển sang full và không mất chữ', async () => {
    const w = mountView()
    await w.find('[aria-label="Xem toàn văn"]').trigger('click')
    expect(w.find('.block-list').exists()).toBe(false)
    const text = w.find('.agent-md-body').text()
    for (const s of ['Role', 'Skills', 'Workflow']) expect(text).toContain(s)
  })

  it('bấm lần nữa quay lại block', async () => {
    const w = mountView()
    await w.find('[aria-label="Xem toàn văn"]').trigger('click')
    await w.find('[aria-label="Xem theo block"]').trigger('click')
    expect(w.find('.block-list').exists()).toBe(true)
  })

  // E10: một section thì toggle vô nghĩa — ẩn đi, giống ArtifactPanel.
  it('chỉ 1 block ⇒ ẩn nút toggle', () => {
    const w = mountView('## Chỉ một\n\nbody', 'one')
    expect(w.find('[aria-label="Xem toàn văn"]').exists()).toBe(false)
  })
})

describe('AgentMarkdownView — gập từng section (TC-29)', () => {
  it('mặc định mở tất cả block', () => {
    const w = mountView()
    expect(w.findAll('.block-item').every((d) => d.attributes('open') !== undefined)).toBe(true)
  })

  it('gập một block không ảnh hưởng block khác, tiêu đề vẫn thấy', async () => {
    const w = mountView()
    const items = w.findAll('.block-item')
    ;(items[1].element as HTMLDetailsElement).open = false
    await items[1].trigger('toggle')
    expect(w.findAll('.block-item')[1].attributes('open')).toBeUndefined()
    expect(w.findAll('.block-item')[2].attributes('open')).toBeDefined()
    expect(w.findAll('.block-item summary')[1].text()).toBe('Role')
  })

  it('gập tất cả rồi mở lại tất cả', async () => {
    const w = mountView()
    await w.find('[aria-label="Thu gọn tất cả"]').trigger('click')
    expect(w.findAll('.block-item').every((d) => d.attributes('open') === undefined)).toBe(true)

    await w.find('[aria-label="Mở tất cả"]').trigger('click')
    expect(w.findAll('.block-item').every((d) => d.attributes('open') !== undefined)).toBe(true)
  })
})

describe('AgentMarkdownView — đổi agent (TC-34, E11)', () => {
  it('đổi agent ⇒ nội dung mới, không sót block của agent cũ', async () => {
    const w = mountView()
    await w.setProps({ name: 'other', content: '## Khác\n\nnội dung khác' })
    await nextTick()
    const labels = w.findAll('.block-item summary').map((s) => s.text())
    expect(labels).toEqual(['Khác'])
    expect(w.html()).not.toContain('Workflow')
  })

  it('đổi agent ⇒ mở lại tất cả block, không giữ index của agent trước', async () => {
    const w = mountView()
    await w.find('[aria-label="Thu gọn tất cả"]').trigger('click')
    await w.setProps({ name: 'other', content: '## A\n\na\n\n## B\n\nb' })
    await nextTick()
    expect(w.findAll('.block-item').every((d) => d.attributes('open') !== undefined)).toBe(true)
  })
})

// TC-32: nội dung agent do người dùng ghi được, giờ render ở một bề mặt mới.
describe('AgentMarkdownView — sanitise nội dung (TC-32)', () => {
  it('loại script và handler inline, giữ phần nội dung lành', () => {
    const w = mountView(
      '## X\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\nvẫn đọc được',
      'evil',
    )
    const html = w.html()
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(w.text()).toContain('vẫn đọc được')
  })
})
