import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ArtifactPanel from '@/features/monitor/components/ArtifactPanel.vue'
import {
  STORAGE_KEY,
  useAppSettings,
} from '@/frontend/composables/useAppSettings'
import { canNavigateToModeKey, navigateToModeKey } from '@/frontend/shell/keys'
import { fetchArtifact, fetchArtifactActions, runArtifactAction, saveArtifact } from '../../../../../src/features/monitor/scripts/ArtifactPanelApi'
import { fetchJob, fetchRunners } from '../../../../../src/features/runner/scripts/runnerApi'

const MD_TWO_H2 = `# Title

## Alpha
Body A

## Beta
Body B
`

const MARKDOWN_FOUR = `## Block A
Nội dung A

## Block B
Nội dung B

## Block C
Nội dung C

## Block D
Nội dung D
`

/** Lightweight stub — avoid mounting Toast UI Editor in jsdom. */
const MarkdownTextEditorStub = defineComponent({
  name: 'MarkdownTextEditor',
  props: {
    modelValue: { type: String, default: '' },
    height: { type: String, default: '320px' },
    autofocus: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'blur'],
  setup(props, { emit, expose }) {
    expose({ focus: () => {} })
    return () =>
      h('textarea', {
        class: 'mock-md-editor',
        'data-testid': 'markdown-text-editor',
        'data-height': props.height,
        value: props.modelValue,
        onInput: (e: Event) => {
          emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
        },
        onBlur: () => emit('blur'),
      })
  },
})

/**
 * Stands in for Toast UI's preview / WYSIWYG surfaces, which render real <a>
 * elements for the markdown being written — inside the panel's own `viewRoot`.
 */
const EditorWithAnchorStub = defineComponent({
  name: 'MarkdownTextEditor',
  props: {
    modelValue: { type: String, default: '' },
    height: { type: String, default: '320px' },
    autofocus: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'blur'],
  setup(_props, { expose }) {
    expose({ focus: () => {} })
    return () => h('div', { class: 'mock-md-preview' }, [h('a', { href: 'design.md' }, 'Design')])
  },
})

vi.mock('@/features/monitor/scripts/ArtifactPanelApi', () => ({
  fetchArtifact: vi.fn(async () => ({ content: MD_TWO_H2, mtime: 1 })),
  fetchArtifactActions: vi.fn(async () => ({ actions: [], menus: [] })),
  runArtifactAction: vi.fn(async () => ({ job: { id: 'job1', status: 'succeeded' } })),
  saveArtifact: vi.fn(async (_taskId: string, _name: string, content: string) => ({
    content,
    mtime: 2,
  })),
}))

vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchRunners: vi.fn(async () => ({ runners: [], defaultRunnerId: null })),
  fetchJob: vi.fn(async () => ({ job: { id: 'job1', status: 'succeeded' } })),
}))

// Keeps `[text](href)` and `**bold**` as real elements — the click-delegation
// tests below need an <a> (and a child node inside one) in the rendered output.
vi.mock('@/frontend/lib/markdownLib', () => ({
  parseMarkdown: (s: string) =>
    `<p>${s
      .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`,
  renderMermaid: vi.fn(async () => {}),
}))

const task = {
  task_id: 'DEMO-1',
  artifacts: {
    'investigate.md': { exists: true, mtime: 1 },
    'design.md': { exists: true, mtime: 1 },
  },
}

/**
 * [T0c6725e9] `extra` mang preference `artifactSection*`. Phải vào storage TRƯỚC khi
 * mount: panel seed trạng thái section ngay trong `load()`, nên đặt setting sau khi
 * panel đã nạp tài liệu là đo nhầm sang ngữ cảnh TC-19.
 *
 * Sau task này "không seed gì" nghĩa là *accordion bật ⇒ đóng hết* (TC-01), nên mọi
 * TC muốn "mở hết" phải nói rõ accordion tắt.
 */
function seedSettings(mode?: 'block' | 'full', extra?: Record<string, unknown>) {
  localStorage.clear()
  const stored = { ...(mode ? { artifactViewMode: mode } : {}), ...(extra ?? {}) }
  if (Object.keys(stored).length) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }
  const { load } = useAppSettings()
  load()
}

/** Accordion tắt + mở tất cả — tức hành vi viewer trước task này. */
const SECTION_LEGACY = { artifactSectionAccordion: false, artifactSectionDefault: 'expanded' }

async function mountPanel(openArtifact: { taskId: string; name: string } | null) {
  const w = mount(ArtifactPanel, {
    props: {
      task,
      openArtifact,
      projectId: null,
    },
    global: {
      stubs: { MarkdownTextEditor: MarkdownTextEditorStub },
    },
  })
  await flushPromises()
  return w
}

beforeEach(() => {
  seedSettings()
})

afterEach(() => {
  localStorage.clear()
  const { load } = useAppSettings()
  load()
  vi.unstubAllGlobals()
})

describe('ArtifactPanel view mode', () => {
  it('TC-AP-01: settings block → .block-list', async () => {
    seedSettings('block')
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'investigate.md' })
    expect(w.find('.block-list').exists()).toBe(true)
  })

  it('TC-AP-02: settings full → no .block-list, has .md-section-wrap', async () => {
    seedSettings('full')
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'investigate.md' })
    expect(w.find('.block-list').exists()).toBe(false)
    expect(w.find('.md-section-wrap').exists()).toBe(true)
  })

  it('TC-AP-03: toolbar Full then open other artifact → reset to Settings block', async () => {
    seedSettings('block')
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'investigate.md' })
    expect(w.find('.block-list').exists()).toBe(true)

    await w.find('.btn-view-mode').trigger('click')
    await flushPromises()
    expect(w.find('.block-list').exists()).toBe(false)

    await w.setProps({ openArtifact: { taskId: 'DEMO-1', name: 'design.md' } })
    await flushPromises()
    expect(w.find('.block-list').exists()).toBe(true)
  })

  it('TC-AP-04: same name, different taskId → re-apply default', async () => {
    seedSettings('block')
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'investigate.md' })
    await w.find('.btn-view-mode').trigger('click')
    await flushPromises()
    expect(w.find('.block-list').exists()).toBe(false)

    await w.setProps({
      task: { ...task, task_id: 'DEMO-2' },
      openArtifact: { taskId: 'DEMO-2', name: 'investigate.md' },
    })
    await flushPromises()
    expect(w.find('.block-list').exists()).toBe(true)
  })

  it('TC-AP-05: toolbar click does not persist settings', async () => {
    seedSettings('block')
    const before = localStorage.getItem(STORAGE_KEY)
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'investigate.md' })
    await w.find('.btn-view-mode').trigger('click')
    await flushPromises()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })
})

describe('ArtifactPanel — MarkdownTextEditor inline edit', () => {
  it('dblclick in full view mounts MarkdownTextEditor instead of raw textarea', async () => {
    seedSettings('full')
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'investigate.md' })

    await w.find('.md-editable').trigger('dblclick')
    await flushPromises()

    expect(w.find('.mock-md-editor').exists()).toBe(true)
    expect(w.find('textarea.cfg-input.art-editor').exists()).toBe(false)
    expect(w.find('.mock-md-editor').attributes('data-height')).toBe('auto')
  })

  it('dblclick a block mounts MarkdownTextEditor for that section', async () => {
    seedSettings('block')
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'investigate.md' })

    await w.find('.block-content.md-editable').trigger('dblclick')
    await flushPromises()

    expect(w.find('.mock-md-editor').exists()).toBe(true)
    expect(w.find('.mock-md-editor').attributes('data-height')).toBe('auto')
  })
})

describe('ArtifactPanel — block mode toggle all', () => {
  function findToggleAllButton(w: Awaited<ReturnType<typeof mountPanel>>) {
    const btn = w
      .findAll('button')
      .find((b) => ['Mở tất cả block', 'Đóng tất cả block'].includes(b.attributes('title') ?? ''))
    if (!btn) throw new Error('toggle-all button not found')
    return btn
  }

  function detailsOpenStates(w: Awaited<ReturnType<typeof mountPanel>>): boolean[] {
    return w.findAll('.block-item').map((d) => (d.element as HTMLDetailsElement).open)
  }

  beforeEach(() => {
    vi.mocked(fetchArtifact).mockImplementation(async () => ({
      content: MARKDOWN_FOUR,
      mtime: 1,
    }))
    // [T0c6725e9] Cả nhóm này chạy dưới accordion TẮT: nút gập/bung toàn bộ chỉ tồn
    // tại ở chế độ đó (TC-13), và "mở hết" giờ phải khai tường minh (TC-04).
    seedSettings('block', SECTION_LEGACY)
  })

  it('opens every block by default when block mode is enabled (mục 4 · TC-04)', async () => {
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })
    expect(detailsOpenStates(w)).toEqual([true, true, true, true])
  })

  it('shows the "collapse all" toggle by default since every block starts open', async () => {
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    const toggle = findToggleAllButton(w)
    expect(toggle.attributes('title')).toBe('Đóng tất cả block')
    expect(toggle.attributes('aria-label')).toBe('Đóng tất cả block')
    expect(toggle.find('svg').exists()).toBe(true)

    await toggle.trigger('click')

    expect(detailsOpenStates(w)).toEqual([false, false, false, false])
  })

  it('re-opens every block once closed via the toggle button', async () => {
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    await findToggleAllButton(w).trigger('click')
    expect(detailsOpenStates(w)).toEqual([false, false, false, false])

    const toggle = findToggleAllButton(w)
    expect(toggle.attributes('title')).toBe('Mở tất cả block')
    expect(toggle.attributes('aria-label')).toBe('Mở tất cả block')
    expect(toggle.find('svg').exists()).toBe(true)

    await toggle.trigger('click')

    expect(detailsOpenStates(w)).toEqual([true, true, true, true])
  })

  it('re-opens a block that was closed by hand once the toggle button is clicked', async () => {
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    const first = w.findAll('.block-item')[0]
    ;(first.element as HTMLDetailsElement).open = false
    await first.trigger('toggle')

    expect(detailsOpenStates(w)[0]).toBe(false)
    expect(findToggleAllButton(w).attributes('title')).toBe('Mở tất cả block')

    await findToggleAllButton(w).trigger('click')

    expect(detailsOpenStates(w)).toEqual([true, true, true, true])
  })
})

describe('ArtifactPanel — block mode first-block summary (mục 2)', () => {
  it('renders a real <summary> for a heading-less first block, same as other blocks', async () => {
    vi.mocked(fetchArtifact).mockImplementation(async () => ({ content: MD_TWO_H2, mtime: 1 }))
    seedSettings('block')
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    const blocks = w.findAll('.block-item')
    // MD_TWO_H2's first line ("# Title") isn't an H2, so block 0 has no heading.
    const firstSummary = blocks[0].find('summary')
    expect(firstSummary.exists()).toBe(true)
    expect(firstSummary.text()).toBe('Chi tiết')

    // Every block — including the fallback-labelled first one — gets the same
    // `.block-item > summary` marker via CSS; a missing <summary> on block 0
    // was the root cause of the oversized default UA-rendered "Details" icon.
    const secondSummary = blocks[1].find('summary')
    expect(secondSummary.exists()).toBe(true)
    expect(secondSummary.text()).toBe('Alpha')
  })
})

describe('ArtifactPanel — QuickAction title toolbar + runner gate', () => {
  afterEach(() => {
    vi.mocked(fetchArtifactActions).mockReset()
    vi.mocked(fetchArtifactActions).mockResolvedValue({ actions: [], menus: [] })
    vi.mocked(fetchRunners).mockReset()
    vi.mocked(fetchRunners).mockResolvedValue({ runners: [], defaultRunnerId: null })
  })

  it('renders only title-attached actions on the title toolbar', async () => {
    vi.mocked(fetchArtifactActions).mockResolvedValue({
      menus: [],
      actions: [
        { id: 'a-title', label: 'Title action', agent_ref: 'x', confirm: false, attach_points: ['artifact-title'] },
        {
          id: 'a-selection',
          label: 'Selection only',
          agent_ref: 'x',
          confirm: false,
          attach_points: ['artifact-selection'],
        },
      ],
    })
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'design.md' })

    const titleButtons = w.findAll('.art-toolbar-actions .btn-quick-action')
    expect(titleButtons).toHaveLength(1)
    expect(titleButtons[0].text()).toContain('Title action')
  })

  it('treats a missing attach_points as title-only (pre-migration hand-edit)', async () => {
    vi.mocked(fetchArtifactActions).mockResolvedValue({
      menus: [],
      actions: [{ id: 'legacy', label: 'Legacy', agent_ref: 'x', confirm: false }],
    })
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'design.md' })

    expect(w.findAll('.art-toolbar-actions .btn-quick-action')).toHaveLength(1)
  })

  it('gates a title action run behind a usable runner, with a CTA to Runner mode', async () => {
    vi.mocked(fetchArtifactActions).mockResolvedValue({
      menus: [],
      actions: [{ id: 'a-title', label: 'Title action', agent_ref: 'x', confirm: false, attach_points: ['artifact-title'] }],
    })
    vi.mocked(fetchRunners).mockResolvedValue({ runners: [{ id: 'r1', name: 'A', enabled: false }], defaultRunnerId: null })
    const navigateToMode = vi.fn()

    const w = mount(ArtifactPanel, {
      props: { task, openArtifact: { taskId: 'DEMO-1', name: 'design.md' }, projectId: null },
      global: {
        provide: { [navigateToModeKey as symbol]: navigateToMode },
        stubs: { MarkdownTextEditor: MarkdownTextEditorStub },
      },
    })
    await flushPromises()

    await w.find('.art-toolbar-actions .btn-quick-action').trigger('click')
    await flushPromises()

    expect(w.text()).toContain('Chưa có runner khả dụng')
    expect(runArtifactAction).not.toHaveBeenCalled()

    const ctaButtons = w.findAll('button').filter((b) => b.text().includes('Mở cấu hình Runner'))
    expect(ctaButtons).toHaveLength(1)
    await ctaButtons[0].trigger('click')
    expect(navigateToMode).toHaveBeenCalledWith('runner')
  })

  // [T2d5cea18] CTA ở trên chỉ đi tới đâu khi mode Runner đang BẬT. Trước đây mode
  // bị tắt trong Cài đặt thì bấm vào không phản hồi gì — `canNavigateToMode` cho
  // call site biết trước để disable nút thay vì để người dùng bấm vào chỗ chết.
  async function mountWithGateError(provide: Record<symbol, unknown>) {
    vi.mocked(fetchArtifactActions).mockResolvedValue({
      menus: [],
      actions: [{ id: 'a-title', label: 'Title action', agent_ref: 'x', confirm: false, attach_points: ['artifact-title'] }],
    })
    vi.mocked(fetchRunners).mockResolvedValue({ runners: [{ id: 'r1', name: 'A', enabled: false }], defaultRunnerId: null })

    const w = mount(ArtifactPanel, {
      props: { task, openArtifact: { taskId: 'DEMO-1', name: 'design.md' }, projectId: null },
      global: { provide, stubs: { MarkdownTextEditor: MarkdownTextEditorStub } },
    })
    await flushPromises()
    // Bấm quick-action khi không có runner khả dụng ⇒ dựng `gateError` ⇒ khối CTA render.
    await w.find('.art-toolbar-actions .btn-quick-action').trigger('click')
    await flushPromises()
    return w
  }
  const runnerCta = (w: any) => w.findAll('button').filter((b: any) => b.text().includes('Mở cấu hình Runner'))[0]

  it('mode Runner đang TẮT → CTA disabled kèm tooltip giải thích', async () => {
    const w = await mountWithGateError({ [canNavigateToModeKey as symbol]: () => false })
    const btn = runnerCta(w)
    expect(btn.attributes('disabled')).toBeDefined()
    // `title` ở <span> bọc ngoài — button disabled không nhận pointer event.
    expect(btn.element.parentElement?.getAttribute('title')).toContain('Chế độ Runner đang tắt')
  })

  it('mode Runner đang BẬT → CTA bấm được và điều hướng đúng một lần', async () => {
    const navigateToMode = vi.fn()
    const w = await mountWithGateError({
      [canNavigateToModeKey as symbol]: () => true,
      [navigateToModeKey as symbol]: navigateToMode,
    })
    const btn = runnerCta(w)
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(navigateToMode).toHaveBeenCalledTimes(1)
    expect(navigateToMode).toHaveBeenCalledWith('runner')
  })

  it('không inject được predicate → CTA vẫn bấm được, giữ đúng hành vi cũ', async () => {
    const w = await mountWithGateError({ [navigateToModeKey as symbol]: vi.fn() })
    expect(runnerCta(w).attributes('disabled')).toBeUndefined()
  })

  it('runs a title action when a usable runner exists', async () => {
    vi.mocked(fetchArtifactActions).mockResolvedValue({
      menus: [],
      actions: [{ id: 'a-title', label: 'Title action', agent_ref: 'x', confirm: false, attach_points: ['artifact-title'] }],
    })
    vi.mocked(fetchRunners).mockResolvedValue({ runners: [{ id: 'r1', name: 'A' }], defaultRunnerId: 'r1' })

    const w = await mountPanel({ taskId: 'DEMO-1', name: 'design.md' })
    await w.find('.art-toolbar-actions .btn-quick-action').trigger('click')
    await flushPromises()

    expect(runArtifactAction).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'DEMO-1', actionId: 'a-title', artifactName: 'design.md' }),
      undefined,
    )
  })

  it('shows a busy overlay while a quick action job is in flight', async () => {
    vi.mocked(fetchArtifactActions).mockResolvedValue({
      menus: [],
      actions: [{ id: 'a-title', label: 'Title action', agent_ref: 'x', confirm: false, attach_points: ['artifact-title'] }],
    })
    vi.mocked(fetchRunners).mockResolvedValue({ runners: [{ id: 'r1', name: 'A' }], defaultRunnerId: 'r1' })
    vi.mocked(runArtifactAction).mockResolvedValue({ job: { id: 'job-busy', status: 'running' } })
    vi.mocked(fetchJob).mockReturnValue(new Promise(() => {})) // keep polling / overlay up

    const w = await mountPanel({ taskId: 'DEMO-1', name: 'design.md' })
    expect(w.find('.art-busy-overlay').exists()).toBe(false)

    await w.find('.art-toolbar-actions .btn-quick-action').trigger('click')
    await flushPromises()

    expect(w.find('.art-busy-overlay').exists()).toBe(true)
    expect(w.find('.art-busy-overlay').attributes('aria-busy')).toBe('true')
  })

  it('renders dropdown menus from the catalog response', async () => {
    vi.mocked(fetchArtifactActions).mockResolvedValue({
      menus: [
        {
          id: 'docs',
          label: 'Tài liệu',
          children: [{ id: 'leaf-a-title', label: 'Title action', action_id: 'a-title' }],
        },
      ],
      actions: [{ id: 'a-title', label: 'Title action', agent_ref: 'x', confirm: false, attach_points: ['artifact-title'] }],
    })
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'design.md' })

    expect(w.find('.qa-menu-trigger').exists()).toBe(true)
    expect(w.find('.qa-menu-trigger').text()).toContain('Tài liệu')
    expect(w.findAll('.art-toolbar-actions .btn-quick-action')).toHaveLength(1) // menu trigger only
  })
})

describe('ArtifactPanel — relative artifact links', () => {
  const MD_LINKS = `## Links

[Design](design.md)

[Dot](./design.md)

[Sub](Tsub/qa.md)

[Missing](khong-co.md)

[Escape](../Tabc/design.md)

[NotMd](pipeline.yaml)

[Unsafe](javascript:alert1)

[External](https://example.com/x)

[Anchor](#muc-2)

[Self](investigate.md)

[**Nested**](notes.md)

Plain paragraph text
`

  const linkTask = {
    task_id: 'DEMO-1',
    artifacts: {
      'investigate.md': { exists: true, mtime: 1 },
      'design.md': { exists: true, mtime: 1 },
      'notes.md': { exists: true, mtime: 1 },
      'khong-co.md': { exists: false },
    },
  }

  let open: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(fetchArtifact).mockImplementation(async () => ({ content: MD_LINKS, mtime: 1 }))
    seedSettings('full')
    open = vi.fn()
    vi.stubGlobal('open', open)
  })

  async function mountLinks() {
    const w = mount(ArtifactPanel, {
      props: {
        task: linkTask,
        openArtifact: { taskId: 'DEMO-1', name: 'investigate.md' },
        projectId: null,
      },
      global: { stubs: { MarkdownTextEditor: MarkdownTextEditorStub } },
    })
    await flushPromises()
    return w
  }

  /** Dispatch a real MouseEvent so `defaultPrevented` is observable. */
  async function clickEl(el: Element, init: MouseEventInit = {}) {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    el.dispatchEvent(ev)
    await flushPromises()
    return ev
  }

  function anchor(w: Awaited<ReturnType<typeof mountLinks>>, href: string) {
    return w.get(`a[href="${href}"]`).element
  }

  function message(w: Awaited<ReturnType<typeof mountLinks>>) {
    const p = w.find('.art-message')
    return p.exists() ? p.text() : ''
  }

  it('TC-L01: opens a sibling artifact and blocks the browser navigation', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, 'design.md'))

    expect(ev.defaultPrevented).toBe(true)
    expect(w.emitted('open-artifact')).toEqual([[{ taskId: 'DEMO-1', name: 'design.md' }]])
  })

  it('TC-L02: resolves a "./" prefixed href', async () => {
    const w = await mountLinks()
    await clickEl(anchor(w, './design.md'))

    expect(w.emitted('open-artifact')).toEqual([[{ taskId: 'DEMO-1', name: 'design.md' }]])
  })

  it('TC-L03: opens a subtask artifact even though it is not listed in task.artifacts', async () => {
    const w = await mountLinks()
    await clickEl(anchor(w, 'Tsub/qa.md'))

    expect(w.emitted('open-artifact')).toEqual([[{ taskId: 'DEMO-1', name: 'Tsub/qa.md' }]])
  })

  it('TC-L20: catches the link from a nested element', async () => {
    const w = await mountLinks()
    await clickEl(w.get('a[href="notes.md"] strong').element)

    expect(w.emitted('open-artifact')).toEqual([[{ taskId: 'DEMO-1', name: 'notes.md' }]])
  })

  it('TC-L07: a link back to the open artifact is a no-op', async () => {
    const w = await mountLinks()
    await clickEl(anchor(w, 'investigate.md'))

    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(message(w)).toBe('')
  })

  it('TC-L10: a missing artifact shows a message and does not navigate', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, 'khong-co.md'))

    expect(ev.defaultPrevented).toBe(true)
    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(message(w)).toContain('khong-co.md')
  })

  it('TC-L11: a link escaping the task folder shows a message and does not navigate', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, '../Tabc/design.md'))

    expect(ev.defaultPrevented).toBe(true)
    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(message(w)).toContain('ngoài thư mục task')
  })

  it('TC-L12: a non-.md link shows a message and does not navigate', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, 'pipeline.yaml'))

    expect(ev.defaultPrevented).toBe(true)
    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(message(w)).toContain('.md')
  })

  it('TC-L14: an unsafe scheme is blocked, with no navigation and no new tab', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, 'javascript:alert1'))

    expect(ev.defaultPrevented).toBe(true)
    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(open).not.toHaveBeenCalled()
    expect(message(w)).toContain('không an toàn')
  })

  it('TC-L16: an absolute link opens in a new tab instead of navigating the SPA', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, 'https://example.com/x'))

    expect(ev.defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer')
    expect(w.emitted('open-artifact')).toBeUndefined()
  })

  it('TC-L17: an anchor-only link keeps the browser default', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, '#muc-2'))

    expect(ev.defaultPrevented).toBe(false)
    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(message(w)).toBe('')
  })

  it('TC-L19: clicking plain text does nothing', async () => {
    const w = await mountLinks()
    const ev = await clickEl(w.get('.md-editable').element)

    expect(ev.defaultPrevented).toBe(false)
    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(message(w)).toBe('')
  })

  it('TC-L21: a modifier click on an artifact link still opens it in the panel', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, 'design.md'), { ctrlKey: true })

    // Href của artifact là đường dẫn file — nhường trình duyệt sẽ mở tab URL rác.
    expect(ev.defaultPrevented).toBe(true)
    expect(w.emitted('open-artifact')).toEqual([[{ taskId: 'DEMO-1', name: 'design.md' }]])
  })

  it('TC-L21: a modifier click on a real web link is left to the browser', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, 'https://example.com/x'), { ctrlKey: true })

    expect(ev.defaultPrevented).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('TC-L14: an unsafe scheme stays blocked under a modifier click', async () => {
    const w = await mountLinks()
    const ev = await clickEl(anchor(w, 'javascript:alert1'), { ctrlKey: true })

    expect(ev.defaultPrevented).toBe(true)
    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(open).not.toHaveBeenCalled()
  })

  it('TC-L10: a subtask artifact that fails to load reports why instead of going blank', async () => {
    const w = await mountLinks()
    vi.mocked(fetchArtifact).mockRejectedValueOnce(new Error('not found'))

    await w.setProps({ openArtifact: { taskId: 'DEMO-1', name: 'Tsub/khong-co.md' } })
    await flushPromises()

    expect(message(w)).toContain('Tsub/khong-co.md')
  })

  it('a link rendered inside the editor is not a navigation link — the draft survives', async () => {
    const w = mount(ArtifactPanel, {
      props: {
        task: linkTask,
        openArtifact: { taskId: 'DEMO-1', name: 'investigate.md' },
        projectId: null,
      },
      global: { stubs: { MarkdownTextEditor: EditorWithAnchorStub } },
    })
    await flushPromises()

    await w.find('.md-editable').trigger('dblclick')
    await flushPromises()

    const ev = await clickEl(w.get('.art-editor a[href="design.md"]').element)

    // Toast UI's preview/WYSIWYG surfaces render real <a> for the text being
    // written; opening them would swap the artifact and drop the unsaved draft.
    expect(ev.defaultPrevented).toBe(false)
    expect(w.emitted('open-artifact')).toBeUndefined()
    expect(w.find('.art-editor').exists()).toBe(true)
  })

  it('TC-L22: a save in flight never overwrites the artifact the link just opened', async () => {
    seedSettings('block')
    let resolveSave: (v: { content: string; mtime: number }) => void = () => {}
    vi.mocked(saveArtifact).mockImplementationOnce(
      () => new Promise((r) => { resolveSave = r }),
    )

    const w = mount(ArtifactPanel, {
      props: {
        task: linkTask,
        openArtifact: { taskId: 'DEMO-1', name: 'investigate.md' },
        projectId: null,
      },
      global: { stubs: { MarkdownTextEditor: MarkdownTextEditorStub } },
    })
    await flushPromises()

    await w.find('.block-content.md-editable').trigger('dblclick')
    await flushPromises()
    await w.get('.mock-md-editor').setValue('## Links\n\nBAN NHAP CHUA LUU')
    await w.get('.mock-md-editor').trigger('blur')

    expect(saveArtifact).toHaveBeenCalledWith(
      'DEMO-1',
      'investigate.md',
      expect.stringContaining('BAN NHAP CHUA LUU'),
      undefined,
      1,
    )

    // The link opens design.md while that save is still in flight.
    vi.mocked(fetchArtifact).mockResolvedValueOnce({
      content: '## Design\n\nNOI DUNG DESIGN',
      mtime: 5,
    })
    await w.setProps({ openArtifact: { taskId: 'DEMO-1', name: 'design.md' } })
    await flushPromises()

    resolveSave({ content: '## Links\n\nBAN NHAP CHUA LUU', mtime: 2 })
    await flushPromises()

    expect(w.text()).toContain('NOI DUNG DESIGN')
    expect(w.text()).not.toContain('BAN NHAP CHUA LUU')
  })

  it('TC-I03: a following valid link clears the previous error message', async () => {
    const w = await mountLinks()
    await clickEl(anchor(w, 'khong-co.md'))
    expect(message(w)).not.toBe('')

    await clickEl(anchor(w, 'design.md'))
    expect(message(w)).toBe('')
  })
})

/**
 * [T0c6725e9] Nhánh **panel artifact (Monitor)** của 2 setting trạng thái section.
 *
 * Logic gập section ở đây là bản cài ĐỘC LẬP với `frontend/ui/CMarkdownView.vue`
 * (design §2.1/D2), nên nhóm này soi đúng những TC mà suite `CMarkdownView` soi —
 * "sửa một viewer, quên viewer kia" là rủi ro số 1 của task (E12).
 *
 * ⚠️ Harness riêng với **mtime khác nhau cho từng artifact**. Phần còn lại của file
 * dùng `mtime: 1` cho mọi artifact; với ranh giới "đổi tài liệu ⇒ áp lại mặc định"
 * thì `mtime` bằng nhau **che mất** ca thật, vì đổi artifact làm watcher `openArtifact`
 * và watcher `mtime` cùng gọi `load()` cho một khoá trong cùng một flush.
 */
describe('ArtifactPanel — trạng thái section mặc định (AC-1, AC-2)', () => {
  const MD_A = '## A1\nnội dung A1\n\n## A2\nnội dung A2\n\n## A3\nnội dung A3\n'
  const MD_B = '## B1\nnội dung B1\n\n## B2\nnội dung B2\n\n## B3\nnội dung B3\n'

  /** `b.md` có mtime KHÁC `a.md` — xem ghi chú harness ở đầu nhóm. */
  const sectionTask = {
    task_id: 'T1',
    artifacts: {
      'a.md': { exists: true, mtime: 1 },
      'b.md': { exists: true, mtime: 77 },
    },
  }

  const CONTENT_BY_NAME: Record<string, { content: string; mtime: number }> = {
    'a.md': { content: MD_A, mtime: 1 },
    'b.md': { content: MD_B, mtime: 77 },
  }

  function openStates(w: Awaited<ReturnType<typeof mountPanel>>): boolean[] {
    return w.findAll('.block-item').map((d) => (d.element as HTMLDetailsElement).open)
  }

  /** Bấm mở/đóng một `<details>` đúng như trình duyệt: đổi `open` rồi bắn `toggle`. */
  async function toggleBlock(
    w: Awaited<ReturnType<typeof mountPanel>>,
    i: number,
    open: boolean,
  ) {
    const item = w.findAll('.block-item')[i]
    ;(item.element as HTMLDetailsElement).open = open
    await item.trigger('toggle')
  }

  function toggleAllButton(w: Awaited<ReturnType<typeof mountPanel>>) {
    return w
      .findAll('button')
      .find((b) => ['Mở tất cả block', 'Đóng tất cả block'].includes(b.attributes('title') ?? ''))
  }

  async function mountSection(
    name = 'a.md',
    task: Record<string, unknown> = sectionTask,
  ) {
    const w = mount(ArtifactPanel, {
      props: { task, openArtifact: { taskId: 'T1', name }, projectId: null },
      global: { stubs: { MarkdownTextEditor: MarkdownTextEditorStub } },
    })
    await flushPromises()
    return w
  }

  beforeEach(() => {
    vi.mocked(fetchArtifact).mockImplementation(async (_taskId: string, name: string) =>
      CONTENT_BY_NAME[name] ?? { content: MD_A, mtime: 1 },
    )
  })

  it('TC-01: cài đặt sạch ⇒ mọi section đóng (accordion mặc định bật ép AC-1)', async () => {
    seedSettings('block')
    expect(openStates(await mountSection())).toEqual([false, false, false])
  })

  it('TC-03: preference không đọc được / sai kiểu ⇒ vẫn ra đúng TC-01, không crash', async () => {
    for (const raw of ['{khong-phai-json', JSON.stringify({ artifactSectionAccordion: 'yes' })]) {
      localStorage.clear()
      localStorage.setItem(STORAGE_KEY, raw)
      useAppSettings().load()
      const w = await mountSection()
      expect(w.find('.block-list').exists()).toBe(true)
      expect(openStates(w)).toEqual([false, false, false])
    }
  })

  it('TC-04: accordion tắt + "mở tất cả" (tường minh HOẶC vắng mặt) ⇒ mở hết', async () => {
    seedSettings('block', { artifactSectionAccordion: false, artifactSectionDefault: 'expanded' })
    expect(openStates(await mountSection())).toEqual([true, true, true])

    seedSettings('block', { artifactSectionAccordion: false })
    expect(openStates(await mountSection())).toEqual([true, true, true])
  })

  it('TC-05/TC-14: accordion tắt + "đóng tất cả" ⇒ đóng hết, và mở được NHIỀU section', async () => {
    seedSettings('block', { artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' })
    const w = await mountSection()
    expect(openStates(w)).toEqual([false, false, false])

    await toggleBlock(w, 0, true)
    await toggleBlock(w, 1, true)
    expect(openStates(w)).toEqual([true, true, false])
  })

  /**
   * TC-06 ở tầng quy tắc thuần nằm trong suite `tests/src/frontend/configs` (đúng
   * phân tầng của test-spec §6). Nhìn từ tầng storage thì ca đó không tới được
   * resolver: `parseAppSettings` all-or-nothing (bất biến sẵn có, cùng đường với
   * `theme: 'neon'`) nên một khoá rác làm hỏng cả object ⇒ mất luôn
   * `artifactSectionAccordion: false` đi kèm ⇒ rơi về đúng TC-01/TC-03.
   */
  it('TC-03/TC-06: AC-1 rác trong storage ⇒ hỏng cả object ⇒ về mặc định đóng hết', async () => {
    seedSettings('block', { artifactSectionAccordion: false, artifactSectionDefault: 'open' })
    expect(openStates(await mountSection())).toEqual([false, false, false])
  })
})

describe('ArtifactPanel — chế độ accordion (AC-2a)', () => {
  const MD_THREE = '## A\nnội dung A\n\n## B\nnội dung B\n\n## C\nnội dung C\n'

  function openStates(w: Awaited<ReturnType<typeof mountPanel>>): boolean[] {
    return w.findAll('.block-item').map((d) => (d.element as HTMLDetailsElement).open)
  }

  async function toggleBlock(
    w: Awaited<ReturnType<typeof mountPanel>>,
    i: number,
    open: boolean,
  ) {
    const item = w.findAll('.block-item')[i]
    ;(item.element as HTMLDetailsElement).open = open
    await item.trigger('toggle')
  }

  function toggleAllButton(w: Awaited<ReturnType<typeof mountPanel>>) {
    return w
      .findAll('button')
      .find((b) => ['Mở tất cả block', 'Đóng tất cả block'].includes(b.attributes('title') ?? ''))
  }

  beforeEach(() => {
    vi.mocked(fetchArtifact).mockImplementation(async () => ({ content: MD_THREE, mtime: 1 }))
  })

  it('TC-09: mở A rồi mở B ⇒ chỉ còn B, và trạng thái đứng yên (E5)', async () => {
    seedSettings('block')
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    await toggleBlock(w, 0, true)
    expect(openStates(w)).toEqual([true, false, false])

    await toggleBlock(w, 1, true)
    expect(openStates(w)).toEqual([false, true, false])

    // Hội tụ: `toggle` vọng lại từ A bị đóng chỉ `delete`, không mở thêm gì.
    await flushPromises()
    expect(openStates(w)).toEqual([false, true, false])
  })

  it('TC-10: bấm lại chính section đang mở ⇒ không còn section nào mở (E4)', async () => {
    seedSettings('block')
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    await toggleBlock(w, 1, true)
    await toggleBlock(w, 1, false)

    expect(openStates(w)).toEqual([false, false, false])
  })

  it('TC-11: tài liệu 1 section ⇒ mở/đóng bình thường', async () => {
    vi.mocked(fetchArtifact).mockImplementation(async () => ({
      content: '## Chỉ một\nnội dung\n',
      mtime: 1,
    }))
    seedSettings('block')
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })
    expect(openStates(w)).toEqual([false])

    await toggleBlock(w, 0, true)
    expect(openStates(w)).toEqual([true])

    await toggleBlock(w, 0, false)
    expect(openStates(w)).toEqual([false])
  })

  it('TC-12: tài liệu rỗng ⇒ không block nào, không nút gập/bung, không lỗi', async () => {
    vi.mocked(fetchArtifact).mockImplementation(async () => ({ content: '', mtime: 1 }))
    seedSettings('block')
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    expect(w.findAll('.block-item')).toHaveLength(0)
    expect(toggleAllButton(w)).toBeUndefined()
    expect(w.find('.art-view').exists()).toBe(true)
  })

  // TC-13/E7: "mở tất cả" mâu thuẫn trực tiếp với "chỉ mở một" — nút phải biến mất,
  // và khi đó TC-10 là lối duy nhất còn lại để thu gọn toàn bộ tài liệu.
  it('TC-13: accordion bật ⇒ KHÔNG có điều khiển gập/bung toàn bộ; tắt thì có lại (TC-07)', async () => {
    seedSettings('block')
    expect(toggleAllButton(await mountPanel({ taskId: 'T1', name: 'design.md' }))).toBeUndefined()

    seedSettings('block', { artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' })
    expect(toggleAllButton(await mountPanel({ taskId: 'T1', name: 'design.md' }))).toBeDefined()
  })

  /**
   * TC-19 — đổi setting khi đang mở tài liệu: áp từ lần nạp kế tiếp, KHÔNG phá chỗ
   * đang đọc. `accordionMode` là computed nên quy tắc bấm đổi ngay (b), còn tập
   * section đang mở giữ nguyên tới lần `load()` sau (a).
   */
  it('TC-19: bật accordion giữa phiên ⇒ không đóng sập, nhưng lần bấm kế đã theo accordion', async () => {
    seedSettings('block', { artifactSectionAccordion: false, artifactSectionDefault: 'expanded' })
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })
    expect(openStates(w)).toEqual([true, true, true])

    // (a) người dùng bật accordion trong Settings rồi quay lại viewer
    useAppSettings().update({ artifactSectionAccordion: true })
    await flushPromises()
    expect(openStates(w)).toEqual([true, true, true])

    // (b) từ lần bấm này trở đi chỉ còn một section mở
    await toggleBlock(w, 1, true)
    expect(openStates(w)).toEqual([false, true, false])
  })
})

/**
 * Nhóm F — ranh giới sống của task: **nạp lại cùng tài liệu** thì GIỮ, **đổi sang
 * tài liệu khác** thì ÁP LẠI. Cài đặt sai ranh giới này thì đúng một trong hai
 * nhóm dưới đây đỏ (E8).
 */
describe('ArtifactPanel — nạp lại cùng tài liệu ⇒ giữ nguyên (TC-23…TC-25)', () => {
  const MD_THREE = '## A\nnội dung A\n\n## B\nnội dung B\n\n## C\nnội dung C\n'
  const MD_THREE_V2 = '## A\nnội dung A đã sửa\n\n## B\nnội dung B\n\n## C\nnội dung C\n'
  const MD_TWO = '## A\nnội dung A\n\n## B\nnội dung B\n'

  const task1 = { task_id: 'T1', artifacts: { 'design.md': { exists: true, mtime: 1 } } }

  function openStates(w: any): boolean[] {
    return w.findAll('.block-item').map((d: any) => (d.element as HTMLDetailsElement).open)
  }

  async function toggleBlock(w: any, i: number, open: boolean) {
    const item = w.findAll('.block-item')[i]
    ;(item.element as HTMLDetailsElement).open = open
    await item.trigger('toggle')
  }

  async function mountDesign(task: Record<string, unknown> = task1) {
    const w = mount(ArtifactPanel, {
      props: { task, openArtifact: { taskId: 'T1', name: 'design.md' }, projectId: null },
      global: { stubs: { MarkdownTextEditor: MarkdownTextEditorStub } },
    })
    await flushPromises()
    return w
  }

  /** Giả lập polling: file đổi ngoài UI ⇒ `task.artifacts[].mtime` mới ⇒ panel tự `load()`. */
  async function pollReload(w: any, next: { content: string; mtime: number }) {
    vi.mocked(fetchArtifact).mockResolvedValue(next)
    await w.setProps({
      task: { ...task1, artifacts: { 'design.md': { exists: true, mtime: next.mtime } } },
    })
    await flushPromises()
  }

  beforeEach(() => {
    vi.mocked(fetchArtifact).mockResolvedValue({ content: MD_THREE, mtime: 1 })
  })

  /**
   * TC-23 · E6 — đây cũng là case bảo vệ chính bản sửa cờ seed trong `load()`: cờ
   * được BẬT theo khoá tài liệu, nên một lần `load()` mới của **cùng** khoá không
   * được seed lại. Seed tràn sang đây là người đọc mất chỗ đang đọc mỗi lần file đổi.
   */
  it('TC-23: accordion bật, file đổi ngoài UI ⇒ section đang mở vẫn mở', async () => {
    seedSettings('block')
    const w = await mountDesign()

    await toggleBlock(w, 1, true)
    expect(openStates(w)).toEqual([false, true, false])

    await pollReload(w, { content: MD_THREE_V2, mtime: 2 })

    expect(w.text()).toContain('nội dung A đã sửa')
    expect(openStates(w)).toEqual([false, true, false])
  })

  it('TC-23: accordion tắt, đã tự gập bớt ⇒ nạp lại KHÔNG bung lại hết', async () => {
    seedSettings('block', SECTION_LEGACY)
    const w = await mountDesign()

    await toggleBlock(w, 0, false)
    await toggleBlock(w, 2, false)
    expect(openStates(w)).toEqual([false, true, false])

    await pollReload(w, { content: MD_THREE_V2, mtime: 2 })

    expect(openStates(w)).toEqual([false, true, false])
  })

  // TC-24/E9: giữ trạng thái theo thứ tự section chỉ hợp lệ khi tập còn bao được.
  it('TC-24: nạp lại với ÍT section hơn ⇒ index thừa bị loại, không có section ma', async () => {
    seedSettings('block', SECTION_LEGACY)
    const w = await mountDesign()
    expect(openStates(w)).toEqual([true, true, true])

    await pollReload(w, { content: MD_TWO, mtime: 2 })

    expect(w.findAll('.block-item')).toHaveLength(2)
    expect(openStates(w)).toEqual([true, true])
  })

  it('TC-25: lưu inline edit một section ⇒ không bung lại toàn bộ tài liệu', async () => {
    seedSettings('block')
    vi.mocked(saveArtifact).mockImplementation(async (_t, _n, content) => ({
      content,
      mtime: 9,
    }))
    const w = await mountDesign()

    await toggleBlock(w, 1, true)
    expect(openStates(w)).toEqual([false, true, false])

    await w.findAll('.block-content.md-editable')[1].trigger('dblclick')
    await flushPromises()
    // Sửa block giữ nguyên heading — bỏ heading là tự gộp section, đổi mất phép đo.
    await w.get('.mock-md-editor').setValue('## B\nnội dung B đã sửa')
    await w.get('.mock-md-editor').trigger('blur')
    await flushPromises()

    expect(saveArtifact).toHaveBeenCalled()
    expect(openStates(w)).toEqual([false, true, false])
  })
})

describe('ArtifactPanel — đổi sang tài liệu khác ⇒ áp lại mặc định (TC-26, TC-27)', () => {
  const MD_A = '## A1\nnội dung A1\n\n## A2\nnội dung A2\n\n## A3\nnội dung A3\n'
  const MD_B = '## B1\nnội dung B1\n\n## B2\nnội dung B2\n\n## B3\nnội dung B3\n'

  /**
   * ⚠️ `mtime` của hai artifact **khác nhau** — đây mới là ca thật. Đổi artifact làm
   * watcher `openArtifact` và watcher `mtime` cùng gọi `load()` cho một khoá trong
   * cùng một flush; `mtime` bằng nhau thì `load()` thứ hai không xảy ra và ca hai-lần-load
   * bị che mất hoàn toàn.
   */
  const pairTask = {
    task_id: 'T1',
    artifacts: {
      'a.md': { exists: true, mtime: 1 },
      'b.md': { exists: true, mtime: 77 },
    },
  }

  function openStates(w: any): boolean[] {
    return w.findAll('.block-item').map((d: any) => (d.element as HTMLDetailsElement).open)
  }

  async function toggleBlock(w: any, i: number, open: boolean) {
    const item = w.findAll('.block-item')[i]
    ;(item.element as HTMLDetailsElement).open = open
    await item.trigger('toggle')
  }

  function mockPair(contentB = MD_B) {
    vi.mocked(fetchArtifact).mockImplementation(async (_taskId: string, name: string) =>
      name === 'b.md' ? { content: contentB, mtime: 77 } : { content: MD_A, mtime: 1 },
    )
  }

  async function mountA() {
    const w = mount(ArtifactPanel, {
      props: { task: pairTask, openArtifact: { taskId: 'T1', name: 'a.md' }, projectId: null },
      global: { stubs: { MarkdownTextEditor: MarkdownTextEditorStub } },
    })
    await flushPromises()
    return w
  }

  /** 3 cấu hình của TC-21/TC-26 → trạng thái mong đợi khi tài liệu mới mở ra. */
  const CONFIGS: Array<[string, Record<string, unknown> | undefined, boolean]> = [
    ['sạch / accordion bật', undefined, false],
    ['accordion tắt + mở tất cả', { artifactSectionAccordion: false, artifactSectionDefault: 'expanded' }, true],
    ['accordion tắt + đóng tất cả', { artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' }, false],
  ]

  beforeEach(() => {
    mockPair()
  })

  it.each(CONFIGS)('TC-26 (%s): trạng thái tay của X không rò sang Y', async (_label, prefs, expected) => {
    seedSettings('block', prefs)
    const w = await mountA()
    expect(openStates(w)).toEqual([expected, expected, expected])

    // Người dùng đảo trạng thái bằng tay trên a.md.
    await toggleBlock(w, 0, !expected)
    expect(openStates(w)[0]).toBe(!expected)

    await w.setProps({ openArtifact: { taskId: 'T1', name: 'b.md' } })
    await flushPromises()

    expect(w.text()).toContain('nội dung B1')
    expect(openStates(w)).toEqual([expected, expected, expected])
  })

  /**
   * Hai artifact nội dung **byte-identical**, `mtime` khác nhau. `watch(content)` chỉ
   * chạy khi giá trị ĐỔI (design §3.2), nên gán một chuỗi trùng khít không bắn watcher:
   * đây là ca duy nhất phân biệt "seed theo khoá tài liệu" với "seed theo nội dung".
   */
  it('TC-26: nội dung trùng khít từng byte vẫn seed lại theo tài liệu', async () => {
    mockPair(MD_A) // b.md có nội dung y hệt a.md
    seedSettings('block', SECTION_LEGACY)
    const w = await mountA()

    await toggleBlock(w, 1, false)
    expect(openStates(w)).toEqual([true, false, true])

    await w.setProps({ openArtifact: { taskId: 'T1', name: 'b.md' } })
    await flushPromises()

    expect(openStates(w)).toEqual([true, true, true])
  })

  /**
   * TC-19(c) — nhánh cuối của "đổi setting giữa phiên đang đọc": trạng thái đang đọc
   * được giữ (TC-19 a/b ở nhóm accordion), nhưng tài liệu MỞ KẾ TIẾP phải theo setting
   * mới. Chạy trên cặp artifact khác `mtime` để không né mất ca hai-lần-`load()`.
   */
  it('TC-19c: bật accordion giữa phiên ⇒ tài liệu mở kế tiếp đóng hết', async () => {
    seedSettings('block', SECTION_LEGACY)
    const w = await mountA()
    expect(openStates(w)).toEqual([true, true, true])

    useAppSettings().update({ artifactSectionAccordion: true })
    await flushPromises()
    expect(openStates(w)).toEqual([true, true, true]) // không đóng sập chỗ đang đọc

    await w.setProps({ openArtifact: { taskId: 'T1', name: 'b.md' } })
    await flushPromises()

    expect(openStates(w)).toEqual([false, false, false])
  })

  it('TC-27: đổi tài liệu khi đang sửa dở ⇒ không crash, Y mở ở trạng thái mặc định', async () => {
    seedSettings('block')
    const w = await mountA()

    await toggleBlock(w, 0, true)
    await w.findAll('.block-content.md-editable')[0].trigger('dblclick')
    await flushPromises()
    expect(w.find('.mock-md-editor').exists()).toBe(true)

    await w.setProps({ openArtifact: { taskId: 'T1', name: 'b.md' } })
    await flushPromises()

    expect(w.find('.mock-md-editor').exists()).toBe(false)
    expect(w.text()).toContain('nội dung B1')
    expect(openStates(w)).toEqual([false, false, false])
  })
})

describe('ArtifactPanel — chế độ xem toàn văn (TC-30)', () => {
  const MD_THREE = '## A\nnội dung A\n\n## B\nnội dung B\n\n## C\nnội dung C\n'

  beforeEach(() => {
    vi.mocked(fetchArtifact).mockImplementation(async () => ({ content: MD_THREE, mtime: 1 }))
  })

  it('2 setting không gây tác dụng phụ ở chế độ toàn văn, quay lại block vẫn áp đúng', async () => {
    for (const [prefs, expected] of [
      [undefined, false],
      [{ artifactSectionAccordion: false, artifactSectionDefault: 'expanded' }, true],
      [{ artifactSectionAccordion: false, artifactSectionDefault: 'collapsed' }, false],
    ] as Array<[Record<string, unknown> | undefined, boolean]>) {
      seedSettings('full', prefs)
      const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

      expect(w.find('.block-list').exists()).toBe(false)
      expect(w.text()).toContain('nội dung A')
      expect(
        w
          .findAll('button')
          .some((b) => ['Mở tất cả block', 'Đóng tất cả block'].includes(b.attributes('title') ?? '')),
      ).toBe(false)

      await w.find('.btn-view-mode').trigger('click')
      await flushPromises()

      expect(
        w.findAll('.block-item').map((d) => (d.element as HTMLDetailsElement).open),
      ).toEqual([expected, expected, expected])
    }
  })
})
