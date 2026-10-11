import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CMarkdownNodes from '@/frontend/ui/CMarkdownNodes.vue'
import { buildMarkdownBlocks, renderNodes, type RenderedNode } from '@/frontend/lib/markdownBlocks'
import { parseMarkdown } from '@/frontend/lib/markdownLib'

/**
 * [Tfe960c47] Render mục con — nhóm §7 của `test-spec.md`.
 *
 * Component này 🚫 KHÔNG parse markdown: HTML dựng sẵn ở computed của viewer
 * (`renderNodes`) rồi truyền xuống qua `node.html` — đó là [must] #1 của
 * `review.md`. Nên nhóm này dựng cây bằng chính đường thật
 * (`buildMarkdownBlocks` → `renderNodes(…, parseMarkdown)`), với `parseMarkdown`
 * BẢN THẬT để DOMPurify còn hiệu lực.
 */

const DOC = `## Block A

Dẫn nhập của A.

### A.1

Nội dung A.1

#### A.1.1

Nội dung sâu hơn

### A.2

Nội dung A.2
`

/** Cây mục con đã kèm HTML của block đầu tiên trong `src`. */
function treeOf(src: string, blockIndex = 0): RenderedNode[] {
  return renderNodes(buildMarkdownBlocks(src)[blockIndex].children, parseMarkdown)
}

function mountNodes(src: string, open: string[] | 'all' = 'all') {
  /**
   * `toggle` chạy bất đồng bộ nên `ev.target.open` đọc SAU lượt test là trạng
   * thái cuối, không phải trạng thái lúc bắn. Ghi lại ngay trong handler.
   */
  const calls: Array<{ path: string; open: boolean }> = []
  const onToggle = vi.fn((path: string, ev: Event) => {
    calls.push({ path, open: (ev.target as HTMLDetailsElement).open })
  })
  const isOpen = (p: string) => open === 'all' || open.includes(p)
  const w = mount(CMarkdownNodes, {
    props: { nodes: treeOf(src), path: '0', isOpen, onToggle },
  })
  return { w, onToggle, calls }
}

/**
 * Mount rồi NUỐT đợt `toggle` sinh ra lúc Vue ghi `open` lần đầu — mỗi
 * `<details>` mở sẵn đều bắn một cú. Không dọn thì mọi phép đếm sau đó đều lệch.
 */
async function mountSettled(src: string, open: string[] | 'all' = 'all') {
  const m = mountNodes(src, open)
  await flushToggle()
  m.onToggle.mockClear()
  m.calls.length = 0
  return m
}

/**
 * Bấm `<summary>` như trình duyệt: đổi `open` rồi để chính jsdom bắn `toggle`.
 *
 * ⚠️ Đo lại trên jsdom@29.1.1 của repo: `toggle` xếp vào **macrotask**, không
 * phải microtask — `await nextTick()` / `flushPromises()` đều CHƯA tới nơi
 * (`test-spec.md` §2.1 ghi là microtask; số đo ở đây mới là số đúng).
 * 🚫 Vẫn không được `dispatchEvent` tay: sẽ đếm thành hai lần.
 */
const flushToggle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function toggleDetails(el: HTMLDetailsElement, open: boolean) {
  el.open = open
  await flushToggle()
}

describe('CMarkdownNodes — cấu trúc `<details>` lồng (TC-E01…E03)', () => {
  it('TC-E01: mỗi mục con là một `<details>` có `<summary>` mang tiêu đề', () => {
    const { w } = mountNodes(DOC)
    const root = w.element as HTMLElement
    const tops = root.querySelectorAll<HTMLDetailsElement>(':scope > details.block-sub')

    expect([...tops].map((d) => d.querySelector('summary')?.textContent)).toEqual(['A.1', 'A.2'])
  })

  it('TC-E02: mục cấp 4 nằm BÊN TRONG `<details>` của mục cấp 3', () => {
    const { w } = mountNodes(DOC)
    const root = w.element as HTMLElement
    const a1 = root.querySelector<HTMLDetailsElement>('[data-node-path="0/0"]')!
    const a11 = root.querySelector<HTMLDetailsElement>('[data-node-path="0/0/0"]')!

    expect(a1.contains(a11)).toBe(true)
    expect(a11.querySelector('summary')?.textContent).toBe('A.1.1')
    // `A.2` là anh em, không phải con.
    expect(a1.contains(root.querySelector('[data-node-path="0/1"]'))).toBe(false)
  })

  it('cấp heading đi vào class để style phân biệt được tầng', () => {
    const { w } = mountNodes(DOC)
    expect(w.find('[data-node-path="0/0"]').classes()).toContain('block-sub--h3')
    expect(w.find('[data-node-path="0/0/0"]').classes()).toContain('block-sub--h4')
  })

  it('TC-E03: thuộc tính `open` phản ánh đúng trạng thái từ `isOpen`', () => {
    const { w } = mountNodes(DOC, ['0/0'])

    expect(w.find('[data-node-path="0/0"]').attributes('open')).toBeDefined()
    expect(w.find('[data-node-path="0/1"]').attributes('open')).toBeUndefined()
    expect(w.find('[data-node-path="0/0/0"]').attributes('open')).toBeUndefined()
  })
})

describe('CMarkdownNodes — sự kiện toggle (TC-E04, TC-E10)', () => {
  it('TC-E04 + TC-E10: mở một mục ⇒ `onToggle` bắn ĐÚNG MỘT lần, đúng path', async () => {
    const { w, onToggle, calls } = await mountSettled(DOC, [])
    const a1 = w.find('[data-node-path="0/0"]').element as HTMLDetailsElement

    await toggleDetails(a1, true)

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([{ path: '0/0', open: true }])
    expect((onToggle.mock.calls[0][1] as Event).target).toBe(a1)
  })

  it('TC-E10: mở rồi đóng ⇒ hai lần, đúng thứ tự trạng thái', async () => {
    const { w, calls } = await mountSettled(DOC, [])
    const a1 = w.find('[data-node-path="0/0"]').element as HTMLDetailsElement

    await toggleDetails(a1, true)
    await toggleDetails(a1, false)

    expect(calls).toEqual([
      { path: '0/0', open: true },
      { path: '0/0', open: false },
    ])
  })

  it('TC-E04: bấm mục con KHÔNG bắn `toggle` của mục cha — `toggle` không bubble', async () => {
    const { w, onToggle, calls } = await mountSettled(DOC, 'all')
    const a11 = w.find('[data-node-path="0/0/0"]').element as HTMLDetailsElement

    await toggleDetails(a11, false)

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([{ path: '0/0/0', open: false }])
  })
})

describe('CMarkdownNodes — nội dung mục con (TC-E05…E09)', () => {
  it('TC-E05: thân mục con vẫn là markdown đã render — list, bảng, link', () => {
    const { w } = mountNodes('## B\n\n### Có đủ\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n[link](https://example.com)\n')
    const body = w.find('[data-node-path="0/0"] .block-sub__body')

    expect(body.find('ul li').exists()).toBe(true)
    expect(body.find('table').exists()).toBe(true)
    expect(body.find('a[href="https://example.com"]').exists()).toBe(true)
  })

  it('TC-E06: `<script>` trong mục con bị DOMPurify loại, phần lành giữ nguyên', () => {
    const { w } = mountNodes('## B\n\n### Xấu\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\nvẫn đọc được\n')

    expect(w.html()).not.toContain('<script')
    expect(w.html()).not.toContain('onerror')
    expect(w.text()).toContain('vẫn đọc được')
  })

  it('TC-E07: `<details>` do người viết gõ vẫn render, không phá `<details>` của cơ chế gập', () => {
    const { w } = mountNodes('## B\n\n### Có details\n\n<details><summary>S</summary>x</details>\n\nsau đó\n')
    const node = w.find('[data-node-path="0/0"]')

    // `<details>` của cơ chế gập là phần tử gốc; cái của người viết nằm trong thân.
    const inner = node.element.querySelectorAll('.block-sub__body details')
    expect(inner).toHaveLength(1)
    expect(inner[0].querySelector('summary')?.textContent).toBe('S')
    // Không bị đóng sớm: đoạn sau `<details>` vẫn thuộc cùng mục con.
    expect(node.text()).toContain('sau đó')
    expect(w.findAll('details.block-sub')).toHaveLength(1)
  })

  it('TC-E08: nhãn `summary` hiển thị nguyên văn, 🚫 không inject HTML thô', () => {
    const { w } = mountNodes('## B\n\n### <b>x</b> & co\n\nbody\n')
    const summary = w.find('[data-node-path="0/0"] > summary')

    expect(summary.text()).toBe('<b>x</b> & co')
    expect(summary.element.querySelector('b')).toBeNull()
  })

  /**
   * Thân mục con render từ `intro`, mà `intro` GỒM chính dòng heading — chủ ý,
   * `_markdown.scss` bỏ gạch chân của heading đầu tiên để không lặp đường kẻ.
   * Nên "thân rỗng" ở đây nghĩa là: ngoài heading ra không còn gì.
   */
  it('TC-E09: mục con rỗng vẫn gập được, thân chỉ còn heading, không ném lỗi', () => {
    const { w } = mountNodes('## B\n\n### A.1\n### A.2\n\nbody\n')

    expect(w.findAll('details.block-sub')).toHaveLength(2)
    const body = w.find('[data-node-path="0/0"] .block-sub__body')
    expect(body.exists()).toBe(true)
    expect(body.find('h3').text()).toBe('A.1')
    expect(body.findAll('p')).toHaveLength(0)
    // Nội dung của mục anh em KHÔNG rơi nhầm vào mục rỗng.
    expect(body.text()).not.toContain('body')
  })

  it('cây rỗng ⇒ không render `<details>` nào, không ném lỗi', () => {
    const w = mount(CMarkdownNodes, {
      props: { nodes: [], path: '0', isOpen: () => false, onToggle: vi.fn() },
    })
    expect(w.findAll('details')).toHaveLength(0)
  })
})

/**
 * [review.md §4 ③] Chốt hồi quy cho [must] #1: component chỉ ĐỌC `node.html`.
 * Nếu ai đó đẩy `parseMarkdown` ngược vào template, mỗi lần gập/mở một mục con
 * sẽ parse lại gần như cả tài liệu.
 */
describe('CMarkdownNodes — 🚫 không parse markdown trong render function', () => {
  it('gập/mở đổi `isOpen` ⇒ số lần `render` của cây vẫn là 0 (HTML đã dựng sẵn)', async () => {
    const render = vi.fn((md: string) => `<p>${md}</p>`)
    const nodes = renderNodes(buildMarkdownBlocks(DOC)[0].children, render)
    const callsAfterBuild = render.mock.calls.length
    expect(callsAfterBuild).toBe(3)

    const open = { value: [] as string[] }
    const w = mount(CMarkdownNodes, {
      props: {
        nodes,
        path: '0',
        isOpen: (p: string) => open.value.includes(p),
        onToggle: vi.fn(),
      },
    })

    open.value = ['0/0']
    await w.setProps({ isOpen: (p: string) => open.value.includes(p) })
    open.value = ['0/0', '0/1']
    await w.setProps({ isOpen: (p: string) => open.value.includes(p) })

    // Delta = 0: không một lần parse nào phát sinh từ việc gập/mở.
    expect(render).toHaveBeenCalledTimes(callsAfterBuild)
    expect(w.find('[data-node-path="0/1"]').attributes('open')).toBeDefined()
  })
})
