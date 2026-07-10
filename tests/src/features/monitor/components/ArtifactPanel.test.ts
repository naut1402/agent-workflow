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

  it('closes every block when "Đóng tất cả" is clicked', async () => {
    stubFetch()
    const w = mountPanel()
    await flushPromises()
    await enableBlockMode(w)

    await findButtonByText(w, 'Đóng tất cả').trigger('click')

    expect(detailsOpenStates(w)).toEqual([false, false, false, false])
  })

  it('opens every block when "Mở tất cả" is clicked', async () => {
    stubFetch()
    const w = mountPanel()
    await flushPromises()
    await enableBlockMode(w)

    await findButtonByText(w, 'Đóng tất cả').trigger('click')
    await findButtonByText(w, 'Mở tất cả').trigger('click')

    expect(detailsOpenStates(w)).toEqual([true, true, true, true])
  })

  it('re-opens a block that was closed by hand once "Mở tất cả" is clicked', async () => {
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

    await findButtonByText(w, 'Mở tất cả').trigger('click')

    expect(detailsOpenStates(w)).toEqual([true, true, true, true])
  })
})
