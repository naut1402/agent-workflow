import { mountWithI18n as mount } from '../../helpers/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CMarkdownView from '@/frontend/ui/CMarkdownView.vue'
import { STORAGE_KEY, useAppSettings } from '@/frontend/composables/useAppSettings'

/**
 * Viewer markdown dùng chung — nâng từ `AgentMarkdownView` khi knowledge cũng
 * cần đúng bề mặt đó (toggle block ↔ full, gập theo section).
 *
 * Hai khác biệt so với bản cũ, cả hai có describe riêng cuối file:
 * `withFrontmatter` là opt-in, và khoá reset là `docKey` chứ không phải `title`.
 */

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
