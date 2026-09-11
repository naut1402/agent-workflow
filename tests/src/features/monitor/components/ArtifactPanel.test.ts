import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ArtifactPanel from '@/features/monitor/components/ArtifactPanel.vue'
import {
  STORAGE_KEY,
  useAppSettings,
} from '@/frontend/composables/useAppSettings'
import { navigateToModeKey } from '@/frontend/shell/keys'
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

function seedSettings(mode?: 'block' | 'full') {
  localStorage.clear()
  if (mode) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ artifactViewMode: mode }))
  }
  const { load } = useAppSettings()
  load()
}

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
    seedSettings('block')
  })

  it('opens every block by default when block mode is enabled (mục 4)', async () => {
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
