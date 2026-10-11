import { mountWithI18n as mount } from '../../helpers/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import CMarkdownView from '@/frontend/ui/CMarkdownView.vue'
import { STORAGE_KEY, useAppSettings } from '@/frontend/composables/useAppSettings'
import { parseMarkdown, renderMermaid } from '@/frontend/lib/markdownLib'

/**
 * Viewer markdown dùng chung — nâng từ `AgentMarkdownView` khi knowledge cũng
 * cần đúng bề mặt đó (toggle block ↔ full, gập theo section).
 *
 * Hai khác biệt so với bản cũ, cả hai có describe riêng cuối file:
 * `withFrontmatter` là opt-in, và khoá reset là `docKey` chứ không phải `title`.
 */

// mermaid không chạy được trong jsdom; parseMarkdown giữ nguyên HÀNH VI thật để
// còn chấm được việc frontmatter ra khối code và markdown thật sự được render —
// [Tfe960c47] chỉ bọc thêm `vi.fn` để đếm được số lần parse (review.md §4 ③).
vi.mock('@/frontend/lib/markdownLib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/frontend/lib/markdownLib')>()
  return {
    ...actual,
    parseMarkdown: vi.fn(actual.parseMarkdown),
    renderMermaid: vi.fn(async () => {}),
  }
})

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

/**
 * [T0c6725e9] Preference `artifactSection*` phải nằm trong storage TRƯỚC khi mount:
 * watcher `docKey` chạy `immediate` nên seed sau khi mount là đo nhầm sang ngữ cảnh
 * "đổi setting giữa phiên đang đọc" (TC-19), không phải trạng thái mặc định.
 *
 * Sau task này "không seed gì" nghĩa là *accordion bật ⇒ đóng hết* (TC-01), nên mọi
 * TC muốn "mở hết" phải nói rõ accordion tắt.
 */
function seedSectionPrefs(prefs?: Record<string, unknown>) {
  localStorage.clear()
  if (prefs) localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  useAppSettings().load()
}

/** Cấu hình quen dùng: accordion tắt + mở tất cả — tức hành vi viewer trước task này. */
const seedLegacyExpandAll = () =>
  seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'expanded' })

const openStates = (w: ReturnType<typeof mount>) =>
  w.findAll('.block-item').map((d) => (d.element as HTMLDetailsElement).open)

/** Bấm mở/đóng một `<details>` đúng như trình duyệt: đổi `open` rồi bắn `toggle`. */
async function toggleBlock(w: ReturnType<typeof mount>, i: number, open: boolean) {
  const item = w.findAll('.block-item')[i]
  ;(item.element as HTMLDetailsElement).open = open
  await item.trigger('toggle')
}

/** Mặc định bật `withFrontmatter` — đây là hành vi mà agent editor đang dùng. */
const mountView = (content = CONTENT, title = 'reviewer', props: Record<string, unknown> = {}) =>
  mount(CMarkdownView, { props: { title, content, withFrontmatter: true, ...props } })

beforeEach(() => {
  seedSectionPrefs()
})

afterEach(() => {
  seedSectionPrefs()
})

describe('CMarkdownView — render markdown (TC-27)', () => {
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

describe('CMarkdownView — toggle block ↔ full (TC-28, E10)', () => {
  it('mặc định ở chế độ block', () => {
    expect(mountView().find('.block-list').exists()).toBe(true)
  })

  it('bấm toggle chuyển sang full và không mất chữ', async () => {
    const w = mountView()
    await w.find('[aria-label="Xem toàn văn"]').trigger('click')
    expect(w.find('.block-list').exists()).toBe(false)
    const text = w.find('.c-md-body').text()
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

describe('CMarkdownView — gập từng section (TC-29)', () => {
  // [T0c6725e9] Accordion tắt + 'expanded' — mở hết không còn là mặc định ngầm nữa.
  it('accordion tắt + "mở tất cả" ⇒ mọi block mở (TC-04)', () => {
    seedLegacyExpandAll()
    const w = mountView()
    expect(w.findAll('.block-item').every((d) => d.attributes('open') !== undefined)).toBe(true)
  })

  it('gập một block không ảnh hưởng block khác, tiêu đề vẫn thấy', async () => {
    seedLegacyExpandAll()
    const w = mountView()
    const items = w.findAll('.block-item')
    ;(items[1].element as HTMLDetailsElement).open = false
    await items[1].trigger('toggle')
    expect(w.findAll('.block-item')[1].attributes('open')).toBeUndefined()
    expect(w.findAll('.block-item')[2].attributes('open')).toBeDefined()
    expect(w.findAll('.block-item summary')[1].text()).toBe('Role')
  })

  it('gập tất cả rồi mở lại tất cả', async () => {
    // Nút toggle-all chỉ tồn tại khi accordion TẮT (TC-13) — cặp với TC-07.
    seedLegacyExpandAll()
    const w = mountView()
    await w.find('[aria-label="Thu gọn tất cả"]').trigger('click')
    expect(w.findAll('.block-item').every((d) => d.attributes('open') === undefined)).toBe(true)

    await w.find('[aria-label="Mở tất cả"]').trigger('click')
    expect(w.findAll('.block-item').every((d) => d.attributes('open') !== undefined)).toBe(true)
  })
})

describe('CMarkdownView — đổi tài liệu (TC-34, E11)', () => {
  it('đổi tài liệu ⇒ nội dung mới, không sót block của tài liệu cũ', async () => {
    const w = mountView()
    await w.setProps({ title: 'other', content: '## Khác\n\nnội dung khác' })
    await nextTick()
    const labels = w.findAll('.block-item summary').map((s) => s.text())
    expect(labels).toEqual(['Khác'])
    expect(w.html()).not.toContain('Workflow')
  })

  it('đổi tài liệu ⇒ mở lại tất cả block, không giữ index của tài liệu trước', async () => {
    seedLegacyExpandAll()
    const w = mountView()
    await w.find('[aria-label="Thu gọn tất cả"]').trigger('click')
    await w.setProps({ title: 'other', content: '## A\n\na\n\n## B\n\nb' })
    await nextTick()
    expect(w.findAll('.block-item').every((d) => d.attributes('open') !== undefined)).toBe(true)
  })

  /**
   * Khoá reset phải là `docKey` khi nguồn có title trùng nhau được — knowledge
   * là đúng ca đó (driver phải thêm hậu tố slug chính vì hai entry trùng title
   * là chuyện thật). Dùng `title` làm khoá thì chuyển giữa hai entry cùng tên
   * sẽ giữ nguyên trạng thái gập của tài liệu trước.
   */
  it('đổi docKey mà title GIỮ NGUYÊN vẫn mở lại tất cả block', async () => {
    seedLegacyExpandAll()
    const w = mountView('## A\n\na\n\n## B\n\nb', 'Trùng tên', { docKey: 'project/a' })
    await w.find('[aria-label="Thu gọn tất cả"]').trigger('click')
    expect(w.findAll('.block-item').every((d) => d.attributes('open') === undefined)).toBe(true)

    await w.setProps({ docKey: 'project/b', content: '## C\n\nc\n\n## D\n\nd' })
    await nextTick()
    expect(w.findAll('.block-item').every((d) => d.attributes('open') !== undefined)).toBe(true)
  })
})

/**
 * Nguồn đã bóc front-matter sẵn (knowledge) thì khối `---` đầu nội dung là
 * **nội dung thật**, không phải metadata.
 */
describe('CMarkdownView — withFrontmatter mặc định false', () => {
  it('không tách block Metadata, nội dung `---` vẫn hiện trong thân tài liệu', () => {
    const w = mount(CMarkdownView, { props: { title: 'entry', content: CONTENT } })
    const labels = w.findAll('.block-item summary').map((s) => s.text())
    expect(labels).not.toContain('Metadata')
    expect(w.text()).toContain('name: reviewer')
  })
})

// TC-32: nội dung do người dùng ghi được, render ở một bề mặt dùng chung.
describe('CMarkdownView — sanitise nội dung (TC-32)', () => {
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

/**
 * [T0c6725e9] Nhánh **markdown view dùng chung** của 2 setting trạng thái section.
 *
 * `CMarkdownView` và `ArtifactPanel` cài cùng một quy tắc bằng hai bản code độc lập
 * (design §2.1/D2), nên nhóm này cố ý soi **cùng** các TC mà suite `ArtifactPanel`
 * soi — "đã sửa một nơi" là chế độ hỏng mặc định của task này (E12).
 */
describe('CMarkdownView — trạng thái section mặc định (AC-1, AC-2)', () => {
  const THREE = '## A\n\na\n\n## B\n\nb\n\n## C\n\nc'
  const mountThree = (props: Record<string, unknown> = {}) =>
    mount(CMarkdownView, { props: { title: 'doc', content: THREE, ...props } })

  it('TC-01: cài đặt sạch ⇒ mọi section đóng (accordion mặc định bật ép AC-1)', () => {
    seedSectionPrefs()
    expect(openStates(mountThree())).toEqual([false, false, false])
  })

  it('TC-03: preference không đọc được / sai kiểu ⇒ vẫn ra đúng TC-01, không crash', () => {
    for (const raw of ['{khong-phai-json', JSON.stringify({ artifactSectionAccordion: 'yes' })]) {
      localStorage.clear()
      localStorage.setItem(STORAGE_KEY, raw)
      useAppSettings().load()
      expect(openStates(mountThree())).toEqual([false, false, false])
    }
  })

  it('TC-04: accordion tắt + "mở tất cả" (tường minh HOẶC vắng mặt) ⇒ mở hết', () => {
    seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'expanded' })
    expect(openStates(mountThree())).toEqual([true, true, true])

    seedSectionPrefs({ artifactSectionAccordion: false })
    expect(openStates(mountThree())).toEqual([true, true, true])
  })

  it('TC-05: accordion tắt + "đóng tất cả" ⇒ đóng hết', () => {
    seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' })
    expect(openStates(mountThree())).toEqual([false, false, false])
  })

  /**
   * TC-06 ở tầng quy tắc thuần nằm trong suite `tests/src/frontend/configs` (đúng
   * phân tầng của test-spec §6): `resolveArtifactSectionDefault` với AC-1 rác +
   * accordion tắt trả `'expanded'`.
   *
   * Nhìn từ tầng storage thì ca đó KHÔNG tới được resolver: `parseAppSettings` là
   * all-or-nothing (bất biến sẵn có, cùng đường với `theme: 'neon'`), nên một khoá
   * rác làm hỏng cả object ⇒ mất luôn `artifactSectionAccordion: false` đi kèm ⇒
   * rơi về đúng TC-01/TC-03. Case này chốt việc đó, để "đóng hết" ở đây không bị
   * đọc nhầm thành resolver sai fallback.
   */
  it('TC-03/TC-06: AC-1 rác trong storage ⇒ hỏng cả object ⇒ về mặc định đóng hết', () => {
    seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'open' })
    expect(openStates(mountThree())).toEqual([false, false, false])
  })
})

describe('CMarkdownView — chế độ accordion (AC-2a)', () => {
  const THREE = '## A\n\na\n\n## B\n\nb\n\n## C\n\nc'
  const mountThree = () => mount(CMarkdownView, { props: { title: 'doc', content: THREE } })

  it('TC-09: mở A rồi mở B ⇒ chỉ còn B, và trạng thái đứng yên (E5)', async () => {
    seedSectionPrefs()
    const w = mountThree()

    await toggleBlock(w, 0, true)
    expect(openStates(w)).toEqual([true, false, false])

    await toggleBlock(w, 1, true)
    expect(openStates(w)).toEqual([false, true, false])

    // Hội tụ: sự kiện `toggle` vọng lại từ A bị đóng không được mở thêm gì.
    await nextTick()
    expect(openStates(w)).toEqual([false, true, false])
  })

  it('TC-10: bấm lại chính section đang mở ⇒ không còn section nào mở (E4)', async () => {
    seedSectionPrefs()
    const w = mountThree()

    await toggleBlock(w, 1, true)
    await toggleBlock(w, 1, false)

    expect(openStates(w)).toEqual([false, false, false])
  })

  it('TC-14: accordion TẮT ⇒ mở A rồi B thì cả hai cùng mở', async () => {
    seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' })
    const w = mountThree()

    await toggleBlock(w, 0, true)
    await toggleBlock(w, 1, true)

    expect(openStates(w)).toEqual([true, true, false])
  })

  it('TC-11: tài liệu 1 section ⇒ mở/đóng bình thường', async () => {
    seedSectionPrefs()
    const w = mount(CMarkdownView, { props: { title: 'one', content: '## Chỉ một\n\nbody' } })
    expect(openStates(w)).toEqual([false])

    await toggleBlock(w, 0, true)
    expect(openStates(w)).toEqual([true])

    await toggleBlock(w, 0, false)
    expect(openStates(w)).toEqual([false])
  })

  it('TC-12: tài liệu rỗng ⇒ không block nào, không nút gập/bung, không lỗi', () => {
    seedSectionPrefs()
    const w = mount(CMarkdownView, { props: { title: 'empty', content: '' } })
    expect(w.findAll('.block-item')).toHaveLength(0)
    expect(w.find('[aria-label="Thu gọn tất cả"]').exists()).toBe(false)
    expect(w.find('[aria-label="Mở tất cả"]').exists()).toBe(false)
  })

  // TC-13/E7: "mở tất cả" mâu thuẫn trực tiếp với "chỉ mở một" — nút phải biến mất,
  // và khi đó TC-10 là lối duy nhất còn lại để thu gọn toàn bộ tài liệu.
  it('TC-13: accordion bật ⇒ KHÔNG có điều khiển gập/bung toàn bộ; tắt thì có lại', () => {
    seedSectionPrefs()
    const on = mountThree()
    expect(on.find('[aria-label="Mở tất cả"]').exists()).toBe(false)
    expect(on.find('[aria-label="Thu gọn tất cả"]').exists()).toBe(false)

    seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' })
    const off = mountThree()
    expect(off.find('[aria-label="Mở tất cả"]').exists()).toBe(true)
  })
})

describe('CMarkdownView — đổi tài liệu áp lại mặc định (TC-26)', () => {
  const A = '## A1\n\na\n\n## A2\n\na\n\n## A3\n\na'
  const B = '## B1\n\nb\n\n## B2\n\nb\n\n## B3\n\nb'

  /** 3 cấu hình của TC-21/TC-26 → trạng thái mong đợi khi tài liệu mới mở ra. */
  const CONFIGS: Array<[string, Record<string, unknown> | undefined, boolean]> = [
    ['sạch / accordion bật', undefined, false],
    ['accordion tắt + mở tất cả', { artifactSectionAccordion: false, artifactSectionDefault: 'expanded' }, true],
    ['accordion tắt + đóng tất cả', { artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' }, false],
  ]

  it.each(CONFIGS)('TC-26 (%s): trạng thái tay của X không rò sang Y', async (_label, prefs, expected) => {
    seedSectionPrefs(prefs)
    const w = mount(CMarkdownView, { props: { title: 'X', docKey: 'p/x', content: A } })

    // Người dùng đảo trạng thái bằng tay trên X.
    await toggleBlock(w, 0, !expected)
    expect(openStates(w)[0]).toBe(!expected)

    await w.setProps({ title: 'Y', docKey: 'p/y', content: B })
    await nextTick()

    expect(openStates(w)).toEqual([expected, expected, expected])
  })

  /**
   * Hai tài liệu nội dung **byte-identical** nhưng khác định danh. `watch(content)`
   * không bắn khi giá trị không đổi (design §3.2), nên đây là ca duy nhất phân biệt
   * "seed theo khoá tài liệu" với "seed theo nội dung".
   */
  it('TC-26: nội dung trùng khít từng byte vẫn seed lại theo docKey', async () => {
    seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'expanded' })
    const w = mount(CMarkdownView, { props: { title: 'Trùng tên', docKey: 'p/a', content: A } })

    await toggleBlock(w, 1, false)
    expect(openStates(w)).toEqual([true, false, true])

    await w.setProps({ docKey: 'p/b' }) // cùng title, cùng content, khác tài liệu
    await nextTick()

    expect(openStates(w)).toEqual([true, true, true])
  })
})

describe('CMarkdownView — chế độ xem toàn văn (TC-30)', () => {
  const THREE = '## A\n\na\n\n## B\n\nb\n\n## C\n\nc'

  it('2 setting không gây tác dụng phụ ở chế độ toàn văn, quay lại block vẫn áp đúng', async () => {
    for (const [prefs, expected] of [
      [undefined, false],
      [{ artifactSectionAccordion: false, artifactSectionDefault: 'expanded' }, true],
      [{ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' }, false],
    ] as Array<[Record<string, unknown> | undefined, boolean]>) {
      seedSectionPrefs(prefs)
      const w = mount(CMarkdownView, { props: { title: 'doc', content: THREE } })

      await w.find('[aria-label="Xem toàn văn"]').trigger('click')
      expect(w.find('.block-list').exists()).toBe(false)
      expect(w.find('.c-md-body').text()).toContain('A')
      expect(w.find('[aria-label="Thu gọn tất cả"]').exists()).toBe(false)
      expect(w.find('[aria-label="Mở tất cả"]').exists()).toBe(false)

      await w.find('[aria-label="Xem theo block"]').trigger('click')
      expect(openStates(w)).toEqual([expected, expected, expected])
    }
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
 * [Tfe960c47] Nhóm §8 + §7 (mermaid) của `test-spec.md`: tầng mục con
 * (`###`…`######`) và nút "lên đầu trang" ở viewer dùng chung — tức cả ba loại
 * tài liệu `agent` · `knowledge` · `rule` cùng lúc.
 * ───────────────────────────────────────────────────────────────────────────*/

/** Tài liệu có đủ hai tầng: 2 block `##`, block đầu có `###` lồng `####`. */
const DOC_NESTED = `## Block A

Dẫn nhập của A.

### A.1

Nội dung A.1

#### A.1.1

Nội dung sâu hơn

### A.2

Nội dung A.2

## Block B

Không có mục con.
`

/** Accordion TẮT + mở tất cả ⇒ cả hai tầng mở sẵn. Đây là nền của phần lớn ca dưới. */
const seedBothExpanded = () =>
  seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'expanded' })

/** Accordion TẮT + đóng tất cả ⇒ cả hai tầng đóng sẵn. */
const seedBothCollapsed = () =>
  seedSectionPrefs({ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' })

const subStates = (w: ReturnType<typeof mount>) =>
  w.findAll('details.block-sub').map((d) => (d.element as HTMLDetailsElement).open)

/**
 * Bấm `<summary>` của một mục con đúng như trình duyệt.
 *
 * ⚠️ 🚫 KHÔNG dùng `trigger('toggle')` ở tầng này: `trigger` của test-utils bắn
 * sự kiện CÓ bubble, mà `toggle` thật thì không — cú vọng lên `.block-item` cha
 * sẽ chạy nhầm `onBlockToggle` và đóng cả block. Đổi `open` rồi để chính jsdom
 * bắn sự kiện (macrotask, đã đo trên jsdom@29.1.1) mới là mô phỏng đúng.
 */
async function toggleSub(w: ReturnType<typeof mount>, path: string, open: boolean) {
  const el = w.find(`[data-node-path="${path}"]`).element as HTMLDetailsElement
  el.open = open
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

/** `scheduleMermaid` là `await nextTick()` rồi mới gọi — cần một nhịp để chấm. */
const flushMermaid = () => flushPromises()

describe('CMarkdownView — gập mục con (TC-F01, TC-E01…E03)', () => {
  it('TC-F01: cả ba loại tài liệu (agent / knowledge / rule) đều gập được mục con và đều có neo về-đầu', () => {
    seedBothExpanded()
    // `withFrontmatter` là khác biệt DUY NHẤT giữa agent (đọc nguyên file .md)
    // và knowledge/rule (nguồn đã bóc front-matter) — cả hai nhánh phải giống nhau.
    for (const withFrontmatter of [true, false]) {
      const w = mount(CMarkdownView, {
        props: { title: 'doc', content: DOC_NESTED, withFrontmatter },
      })
      expect(w.findAll('details.block-sub').length).toBe(3)
      expect(w.find('.c-scroll-top').exists()).toBe(true)
    }
  })

  it('mục con là `<details>` lồng đúng tầng, mang path ổn định', () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    const paths = w.findAll('details.block-sub').map((d) => d.attributes('data-node-path'))

    expect(paths).toEqual(['0/0', '0/0/0', '0/1'])
    const a1 = w.find('[data-node-path="0/0"]').element
    expect(a1.contains(w.find('[data-node-path="0/0/0"]').element)).toBe(true)
  })

  it('TC-B04 qua UI: gập một mục con không đụng block cha lẫn mục anh em', async () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    expect(subStates(w)).toEqual([true, true, true])

    await toggleSub(w, '0/0', false)

    expect(subStates(w)).toEqual([false, true, true])
    expect(openStates(w)[0]).toBe(true)
  })

  it('TC-H08: tài liệu KHÔNG có mục con nhìn y hệt trước task — không `<details>` lạ nào', () => {
    seedBothExpanded()
    const w = mountView('## A\n\na\n\n## B\n\nb', 'phang')

    expect(w.findAll('details.block-sub')).toHaveLength(0)
    expect(w.findAll('.block-item')).toHaveLength(2)
    expect(w.text()).toContain('a')
    expect(w.text()).toContain('b')
  })
})

describe('CMarkdownView — seed hai tầng theo preference (TC-F03, TC-B01…B03)', () => {
  it('TC-B01/TC-F03: mặc định "mở tất cả" ⇒ mục con mở sẵn, không đổi hành vi đọc hôm nay', () => {
    seedBothExpanded()
    expect(subStates(mountView(DOC_NESTED, 'doc'))).toEqual([true, true, true])
  })

  it('TC-B02: mặc định "đóng tất cả" ⇒ mục con đóng sẵn', () => {
    seedBothCollapsed()
    expect(subStates(mountView(DOC_NESTED, 'doc'))).toEqual([false, false, false])
  })

  /**
   * TC-B03: accordion BẬT (mặc định) chỉ ép tầng khối về `collapsed`. Tầng mục
   * con đọc giá trị LƯU (`readArtifactSectionDefault`), nên mở một block ra vẫn
   * thấy đủ nội dung chứ không phải một dãy tiêu đề rỗng.
   */
  it('TC-B03: accordion bật ⇒ block đóng hết nhưng mục con vẫn theo giá trị đã lưu', () => {
    seedSectionPrefs() // sạch: accordion bật, artifactSectionDefault vắng ⇒ 'expanded'
    const w = mountView(DOC_NESTED, 'doc')

    expect(openStates(w)).toEqual([false, false])
    expect(subStates(w)).toEqual([true, true, true])
  })
})

describe('CMarkdownView — mở/thu tất cả phủ cả hai tầng (TC-F05)', () => {
  it('TC-F05: "thu gọn tất cả" rồi "mở tất cả" áp cho CẢ block lẫn mục con', async () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')

    await w.find('[aria-label="Thu gọn tất cả"]').trigger('click')
    expect(openStates(w).every((o) => !o)).toBe(true)
    expect(subStates(w).every((o) => !o)).toBe(true)

    await w.find('[aria-label="Mở tất cả"]').trigger('click')
    expect(openStates(w).every(Boolean)).toBe(true)
    expect(subStates(w).every(Boolean)).toBe(true)
  })
})

describe('CMarkdownView — đổi tài liệu & đổi nội dung (TC-F04, TC-B11, TC-B12)', () => {
  it('TC-F04: đổi docKey ⇒ CẢ HAI tầng seed lại theo preference', async () => {
    seedBothExpanded()
    const w = mount(CMarkdownView, {
      props: { title: 'X', docKey: 'p/x', content: DOC_NESTED },
    })
    await toggleSub(w, '0/0', false)
    expect(subStates(w)).toEqual([false, true, true])

    await w.setProps({ docKey: 'p/y', content: '## C\n\nc\n\n### C.1\n\nc1\n' })
    await nextTick()

    expect(subStates(w)).toEqual([true])
  })

  it('TC-B11: cùng tài liệu, mục con biến mất ⇒ lựa chọn của người dùng còn nguyên', async () => {
    seedBothExpanded()
    const w = mount(CMarkdownView, {
      props: { title: 'X', docKey: 'p/x', content: DOC_NESTED },
    })
    await toggleSub(w, '0/1', false)

    // Xoá `### A.2` — `docKey` giữ nguyên nên đi nhánh `prune`, không phải `seed`.
    await w.setProps({ content: DOC_NESTED.replace(/### A\.2[\s\S]*?(?=## Block B)/, '') })
    await nextTick()

    expect(w.findAll('details.block-sub').map((d) => d.attributes('data-node-path'))).toEqual([
      '0/0',
      '0/0/0',
    ])
    expect(subStates(w)).toEqual([true, true])
  })

  it('TC-B12: mục con MỚI xuất hiện nhận mặc định "mở", không tự biến mất', async () => {
    seedBothExpanded()
    const w = mount(CMarkdownView, {
      props: { title: 'X', docKey: 'p/x', content: DOC_NESTED },
    })

    await w.setProps({ content: DOC_NESTED.replace('## Block B', '### A.3\n\nmới\n\n## Block B') })
    await nextTick()

    const a3 = w.find('[data-node-path="0/2"]')
    expect(a3.exists()).toBe(true)
    expect((a3.element as HTMLDetailsElement).open).toBe(true)
    expect(a3.text()).toContain('mới')
  })
})

describe('CMarkdownView — chế độ toàn văn ↔ block (TC-F06)', () => {
  it('TC-F06: chuyển sang toàn văn rồi quay lại GIỮ NGUYÊN trạng thái gập mục con', async () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    await toggleSub(w, '0/0', false)
    expect(subStates(w)).toEqual([false, true, true])

    await w.find('[aria-label="Xem toàn văn"]').trigger('click')
    expect(w.findAll('details.block-sub')).toHaveLength(0)

    await w.find('[aria-label="Xem theo block"]').trigger('click')
    expect(subStates(w)).toEqual([false, true, true])
  })

  it('toàn văn KHÔNG mất nội dung mục con — mọi đoạn đều còn', async () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    await w.find('[aria-label="Xem toàn văn"]').trigger('click')

    const text = w.find('.c-md-body').text()
    for (const s of ['Dẫn nhập của A.', 'Nội dung A.1', 'Nội dung sâu hơn', 'Nội dung A.2']) {
      expect(text).toContain(s)
    }
  })
})

describe('CMarkdownView — tài liệu dài (TC-F07)', () => {
  it('TC-F07: ~2000 dòng với nhiều mục con — render xong, gập được, không ném lỗi', () => {
    seedBothExpanded()
    const long =
      '## Dài\n\n' +
      Array.from({ length: 300 }, (_, i) => `### Mục ${i}\n\ndòng 1 của ${i}\n\ndòng 2 của ${i}\n`).join('\n')

    const w = mountView(long, 'long')
    expect(w.findAll('details.block-sub')).toHaveLength(300)
    expect(subStates(w).every(Boolean)).toBe(true)
  })
})

/**
 * [review.md §4 ③] Chốt hồi quy cho [must] #1 và [should] #1.
 *
 * `parseMarkdown` nằm ở computed ⇒ gập/mở một mục con KHÔNG parse lại gì
 * (delta = 0, trước khi sửa là +4); `renderMermaid` gọi đúng 1 lần khi mở tài
 * liệu (trước khi sửa là 4).
 */
describe('CMarkdownView — số lần parse / renderMermaid (review §4 ③)', () => {
  const parseSpy = vi.mocked(parseMarkdown)
  const mermaidSpy = vi.mocked(renderMermaid)

  it('mở MỘT mục con ⇒ delta số lần parse = 0', async () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    await flushMermaid()

    parseSpy.mockClear()
    await toggleSub(w, '0/0', false)
    await toggleSub(w, '0/0', true)
    await flushMermaid()

    expect(parseSpy).toHaveBeenCalledTimes(0)
  })

  it('gập/mở một BLOCK cũng không parse lại — hai tầng cùng một hợp đồng', async () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    await flushMermaid()

    parseSpy.mockClear()
    const item = w.findAll('.block-item')[0]
    ;(item.element as HTMLDetailsElement).open = false
    await item.trigger('toggle')
    await flushMermaid()

    expect(parseSpy).toHaveBeenCalledTimes(0)
  })

  it('mở tài liệu ⇒ `renderMermaid` gọi ĐÚNG 1 lần, không một lần mỗi block', async () => {
    seedBothExpanded()
    mermaidSpy.mockClear()
    mountView(DOC_NESTED, 'doc')
    await flushMermaid()

    expect(mermaidSpy).toHaveBeenCalledTimes(1)
  })

  it('nội dung đổi ⇒ parse lại (computed không được "đông cứng")', async () => {
    seedBothExpanded()
    const w = mount(CMarkdownView, { props: { title: 'X', docKey: 'p/x', content: DOC_NESTED } })
    await flushMermaid()

    parseSpy.mockClear()
    await w.setProps({ content: '## Mới\n\nnội dung mới\n' })
    await nextTick()

    expect(parseSpy.mock.calls.length).toBeGreaterThan(0)
    expect(w.text()).toContain('nội dung mới')
  })
})

/**
 * TC-E11…E13: mermaid chỉ vẽ được khi phần tử đang HIỆN, nên `renderMermaid`
 * phải chạy sau mỗi lần có thứ gì đó vừa mở — và chỉ khi đó.
 */
describe('CMarkdownView — mermaid theo trạng thái gập (TC-E11…E13)', () => {
  const mermaidSpy = vi.mocked(renderMermaid)
  const WITH_MERMAID = '## A\n\n### Sơ đồ\n\n```mermaid\ngraph TD; A-->B;\n```\n'

  it('TC-E12: mọi thứ còn đóng ⇒ 🚫 không gọi `renderMermaid`', async () => {
    seedBothCollapsed()
    mermaidSpy.mockClear()
    mountView(WITH_MERMAID, 'doc')
    await flushMermaid()

    expect(mermaidSpy).not.toHaveBeenCalled()
  })

  it('TC-E11: mở mục con chứa mermaid ⇒ `renderMermaid` chạy, và chạy trên gốc viewer', async () => {
    seedBothCollapsed()
    const w = mountView(WITH_MERMAID, 'doc')
    await flushMermaid()
    mermaidSpy.mockClear()

    await toggleSub(w, '0/0', true)
    await flushMermaid()

    expect(mermaidSpy).toHaveBeenCalledTimes(1)
    expect(mermaidSpy.mock.calls[0][0]).toBe(w.find('.c-md-body').element)
  })

  it('TC-E13: đóng rồi mở lại ⇒ vẽ lại, không để sơ đồ rỗng', async () => {
    seedBothCollapsed()
    const w = mountView(WITH_MERMAID, 'doc')
    await flushMermaid()

    await toggleSub(w, '0/0', true)
    await flushMermaid()
    mermaidSpy.mockClear()

    await toggleSub(w, '0/0', false)
    await flushMermaid()
    expect(mermaidSpy).not.toHaveBeenCalled() // đóng thì không cần vẽ

    await toggleSub(w, '0/0', true)
    await flushMermaid()
    expect(mermaidSpy).toHaveBeenCalledTimes(1)
  })
})

/**
 * §5/§6 nhìn từ viewer: nút về-đầu phải neo vào CHÍNH `.c-md-body`, không phải
 * `window` — đó là điều kiện để hai bề mặt cuộn (viewer và trang task) không lẫn.
 */
describe('CMarkdownView — nút lên đầu trang (TC-F02, TC-G03)', () => {
  /** jsdom không có layout ⇒ khai `clientHeight` tay, ngưỡng rơi về sàn 200px. */
  function scrollBody(w: ReturnType<typeof mount>, top: number) {
    const body = w.find('.c-md-body').element as HTMLElement
    body.scrollTop = top
    body.dispatchEvent(new Event('scroll'))
    return body
  }

  it('TC-F02: cuộn `.c-md-body` quá ngưỡng ⇒ nút hiện; click đưa chính nó về đầu', async () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    expect(w.find('.c-scroll-top__btn').exists()).toBe(false)

    const body = scrollBody(w, 900)
    await nextTick()
    expect(w.find('.c-scroll-top__btn').exists()).toBe(true)

    await w.find('.c-scroll-top__btn').trigger('click')
    expect(body.scrollTop).toBe(0)
  })

  it('TC-F02b: neo nằm TRONG vùng cuộn, không treo ngoài toolbar', () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    const body = w.find('.c-md-body').element
    expect(body.contains(w.find('.c-scroll-top').element)).toBe(true)
    expect(w.find('.c-md-toolbar').element.contains(w.find('.c-scroll-top').element)).toBe(false)
  })

  it('TC-F04b: đổi tài liệu sang bản ngắn ⇒ nút tự ẩn (đường dây contentKey, E16)', async () => {
    seedBothExpanded()
    const w = mount(CMarkdownView, { props: { title: 'X', docKey: 'p/x', content: DOC_NESTED } })
    const body = scrollBody(w, 900)
    await nextTick()
    expect(w.find('.c-scroll-top__btn').exists()).toBe(true)

    body.scrollTop = 0 // tài liệu ngắn đi: trình duyệt kẹp về 0, không bắn `scroll`
    await w.setProps({ docKey: 'p/y', content: '## Ngắn\n\nmột dòng' })
    await flushPromises()

    expect(w.find('.c-scroll-top__btn').exists()).toBe(false)
  })

  it('TC-G13: tài liệu rỗng ⇒ vẫn có neo, không nút mồ côi, không ném lỗi', () => {
    seedBothExpanded()
    const w = mount(CMarkdownView, { props: { title: 'empty', content: '' } })

    expect(w.find('.c-scroll-top').exists()).toBe(true)
    expect(w.find('.c-scroll-top__btn').exists()).toBe(false)
  })
})

describe('CMarkdownView — sanitise mục con (TC-E06, TC-I04)', () => {
  it('TC-E06: `<script>` trong một mục con vẫn bị loại', () => {
    seedBothExpanded()
    const w = mountView('## A\n\n### Xấu\n\n<script>alert(1)</script>\n\nvẫn đọc được\n', 'evil')

    expect(w.html()).not.toContain('<script')
    expect(w.text()).toContain('vẫn đọc được')
  })

  it('TC-I04: nhãn nút về-đầu lấy từ i18n, 🚫 không hardcode trong template', async () => {
    seedBothExpanded()
    const w = mountView(DOC_NESTED, 'doc')
    const body = w.find('.c-md-body').element as HTMLElement
    body.scrollTop = 900
    body.dispatchEvent(new Event('scroll'))
    await nextTick()

    expect(w.find('.c-scroll-top__btn').attributes('aria-label')).toBe('Lên đầu trang')
  })
})
