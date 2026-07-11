import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ArtifactPanel from '@/features/monitor/components/ArtifactPanel.vue'
import {
  STORAGE_KEY,
  useAppSettings,
} from '@/shared/composables/useAppSettings'
import { fetchArtifact } from '@/api'

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

vi.mock('@/api', () => ({
  fetchArtifact: vi.fn(async () => ({ content: MD_TWO_H2, mtime: 1 })),
  fetchArtifactActions: vi.fn(async () => ({ actions: [] })),
  saveArtifact: vi.fn(async (_taskId: string, _name: string, content: string) => ({
    content,
    mtime: 2,
  })),
}))

vi.mock('@/shared/markdown', () => ({
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

    await w.find('.btn-view-toggle').trigger('click')
    await flushPromises()
    expect(w.find('.block-list').exists()).toBe(false)

    await w.setProps({ openArtifact: { taskId: 'DEMO-1', name: 'design.md' } })
    await flushPromises()
    expect(w.find('.block-list').exists()).toBe(true)
  })

  it('TC-AP-04: same name, different taskId → re-apply default', async () => {
    seedSettings('block')
    const w = await mountPanel({ taskId: 'DEMO-1', name: 'investigate.md' })
    await w.find('.btn-view-toggle').trigger('click')
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
    await w.find('.btn-view-toggle').trigger('click')
    await flushPromises()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
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

  it('opens the first 3 blocks by default when block mode is enabled', async () => {
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })
    expect(detailsOpenStates(w)).toEqual([true, true, true, false])
  })

  it('opens every block when the toggle button is clicked while some are closed', async () => {
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    const toggle = findToggleAllButton(w)
    expect(toggle.attributes('title')).toBe('Mở tất cả block')
    expect(toggle.text()).toBe('▼')

    await toggle.trigger('click')

    expect(detailsOpenStates(w)).toEqual([true, true, true, true])
  })

  it('closes every block when the toggle button is clicked while all are open', async () => {
    const w = await mountPanel({ taskId: 'T1', name: 'design.md' })

    await findToggleAllButton(w).trigger('click')
    expect(detailsOpenStates(w)).toEqual([true, true, true, true])

    const toggle = findToggleAllButton(w)
    expect(toggle.attributes('title')).toBe('Đóng tất cả block')
    expect(toggle.text()).toBe('▲')

    await toggle.trigger('click')

    expect(detailsOpenStates(w)).toEqual([false, false, false, false])
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
