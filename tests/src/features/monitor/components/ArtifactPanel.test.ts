import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ArtifactPanel from '@/features/monitor/components/ArtifactPanel.vue'
import {
  STORAGE_KEY,
  useAppSettings,
} from '@/core/composables/useAppSettings'
import { navigateToModeKey } from '@/core/shell/keys'
import { fetchArtifact, fetchArtifactActions, fetchRunners, runArtifactAction } from '@/api'

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

vi.mock('@/api', () => ({
  fetchArtifact: vi.fn(async () => ({ content: MD_TWO_H2, mtime: 1 })),
  fetchArtifactActions: vi.fn(async () => ({ actions: [], menus: [] })),
  fetchRunners: vi.fn(async () => ({ runners: [], defaultRunnerId: null })),
  runArtifactAction: vi.fn(async () => ({ job: { id: 'job1', status: 'succeeded' } })),
  fetchJob: vi.fn(async () => ({ job: { id: 'job1', status: 'succeeded' } })),
  saveArtifact: vi.fn(async (_taskId: string, _name: string, content: string) => ({
    content,
    mtime: 2,
  })),
}))

vi.mock('@/core/markdown', () => ({
  parseMarkdown: (s: string) => `<p>${s}</p>`,
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
