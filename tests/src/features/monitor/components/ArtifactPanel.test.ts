import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ArtifactPanel from '@/features/monitor/components/ArtifactPanel.vue'

const MARKDOWN = `## Block A
Nội dung A

## Block B
Nội dung B

## Block C
Nội dung C

## Block D
Nội dung D
`

function stubFetch() {
  const mock = vi.fn(async (input: any) => {
    const url = String(input)
    if (url.includes('/api/artifact-actions')) {
      return { ok: true, json: async () => ({ actions: [] }) }
    }
    if (url.includes('/api/artifact')) {
      return { ok: true, json: async () => ({ content: MARKDOWN, mtime: 1 }) }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function mountPanel() {
  return mount(ArtifactPanel, {
    props: {
      task: { artifacts: { 'design.md': { mtime: 1 } } },
      openArtifact: { taskId: 'T1', name: 'design.md' },
      projectId: null,
    },
  })
}

function findButtonByText(w: ReturnType<typeof mountPanel>, text: string) {
  const btn = w.findAll('button').find((b) => b.text().includes(text))
  if (!btn) throw new Error(`button not found: ${text}`)
  return btn
}

// Nút toggle mở/đóng tất cả block giờ là icon-only — tìm theo `title` (tooltip),
// không còn text "Mở tất cả"/"Đóng tất cả" trong nội dung nút.
function findToggleAllButton(w: ReturnType<typeof mountPanel>) {
  const btn = w
    .findAll('button')
    .find((b) => ['Mở tất cả block', 'Đóng tất cả block'].includes(b.attributes('title') ?? ''))
  if (!btn) throw new Error('toggle-all button not found')
  return btn
}

async function enableBlockMode(w: ReturnType<typeof mountPanel>) {
  await findButtonByText(w, '🗂 Blocks').trigger('click')
}

function detailsOpenStates(w: ReturnType<typeof mountPanel>): boolean[] {
  return w.findAll('.block-item').map((d) => (d.element as HTMLDetailsElement).open)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ArtifactPanel — block mode toggle all', () => {
  it('opens the first 3 blocks by default when block mode is enabled', async () => {
    stubFetch()
    const w = mountPanel()
    await flushPromises()

    await enableBlockMode(w)

    expect(detailsOpenStates(w)).toEqual([true, true, true, false])
  })

  it('opens every block when the toggle button is clicked while some are closed', async () => {
    stubFetch()
    const w = mountPanel()
    await flushPromises()
    await enableBlockMode(w)

    // Default state: 3/4 blocks open → chưa phải "tất cả mở" → nút hiện "▼" / title mở-tất-cả.
    const toggle = findToggleAllButton(w)
    expect(toggle.attributes('title')).toBe('Mở tất cả block')
    expect(toggle.text()).toBe('▼')

    await toggle.trigger('click')

    expect(detailsOpenStates(w)).toEqual([true, true, true, true])
  })

  it('closes every block when the toggle button is clicked while all are open', async () => {
    stubFetch()
    const w = mountPanel()
    await flushPromises()
    await enableBlockMode(w)

    await findToggleAllButton(w).trigger('click') // mở hết trước
    expect(detailsOpenStates(w)).toEqual([true, true, true, true])

    const toggle = findToggleAllButton(w)
    expect(toggle.attributes('title')).toBe('Đóng tất cả block')
    expect(toggle.text()).toBe('▲')

    await toggle.trigger('click')

    expect(detailsOpenStates(w)).toEqual([false, false, false, false])
  })

  it('re-opens a block that was closed by hand once the toggle button is clicked', async () => {
    stubFetch()
    const w = mountPanel()
    await flushPromises()
    await enableBlockMode(w)

    // Simulate the user collapsing the first block by hand (native <summary> click),
    // which fires a native `toggle` event with `open` already flipped to false.
    const first = w.findAll('.block-item')[0]
    ;(first.element as HTMLDetailsElement).open = false
    await first.trigger('toggle')

    expect(detailsOpenStates(w)[0]).toBe(false)
    expect(findToggleAllButton(w).attributes('title')).toBe('Mở tất cả block')

    await findToggleAllButton(w).trigger('click')

    expect(detailsOpenStates(w)).toEqual([true, true, true, true])
  })
})
