import { afterEach, describe, expect, it, vi } from 'vitest'
import { useArtifactSelectionToolbar } from '@/features/monitor/composables/useArtifactSelectionToolbar'

// jsdom's Selection API doesn't reflect real DOM selections made by test
// helpers, so we stub `window.getSelection()` directly and drive
// `onSelectionChange()` by hand — the same shape the composable would see
// when `selectionchange`/`mouseup` fires in a real browser.

function stubSelection(
  container: HTMLElement,
  opts: { text: string; collapsed?: boolean; insideContainer?: boolean } | null,
) {
  const fake = opts
    ? ({
        rangeCount: 1,
        isCollapsed: opts.collapsed ?? false,
        toString: () => opts.text,
        getRangeAt: () => ({
          commonAncestorContainer: opts.insideContainer === false ? document.createElement('div') : container,
          getBoundingClientRect: () => ({ top: 10, left: 20, width: 100, height: 16 }),
        }),
      } as unknown as Selection)
    : null
  return vi.spyOn(window, 'getSelection').mockReturnValue(fake)
}

afterEach(() => vi.restoreAllMocks())

describe('useArtifactSelectionToolbar', () => {
  it('starts hidden', () => {
    const container = document.createElement('div')
    const t = useArtifactSelectionToolbar({ getContainer: () => container, isBlocked: () => false })
    expect(t.visible.value).toBe(false)
    expect(t.text.value).toBe('')
    expect(t.rect.value).toBeNull()
  })

  it('shows the toolbar for a non-empty selection inside the container', () => {
    const container = document.createElement('div')
    stubSelection(container, { text: '  đoạn bôi đen  ' })
    const t = useArtifactSelectionToolbar({ getContainer: () => container, isBlocked: () => false })

    t.onSelectionChange()

    expect(t.visible.value).toBe(true)
    expect(t.text.value).toBe('đoạn bôi đen')
    expect(t.rect.value).toEqual({ top: 10, left: 20, width: 100, height: 16 })
  })

  it('hides when blocked (editing / no artifact open)', () => {
    const container = document.createElement('div')
    stubSelection(container, { text: 'x' })
    const t = useArtifactSelectionToolbar({ getContainer: () => container, isBlocked: () => true })

    t.onSelectionChange()

    expect(t.visible.value).toBe(false)
  })

  it('hides when the selection is empty/collapsed', () => {
    const container = document.createElement('div')
    stubSelection(container, { text: '', collapsed: true })
    const t = useArtifactSelectionToolbar({ getContainer: () => container, isBlocked: () => false })

    t.onSelectionChange()

    expect(t.visible.value).toBe(false)
  })

  it('hides when the selection falls outside the viewer container', () => {
    const container = document.createElement('div')
    stubSelection(container, { text: 'outside text', insideContainer: false })
    const t = useArtifactSelectionToolbar({ getContainer: () => container, isBlocked: () => false })

    t.onSelectionChange()

    expect(t.visible.value).toBe(false)
  })

  it('hide() clears visible/text/rect', () => {
    const container = document.createElement('div')
    stubSelection(container, { text: 'x' })
    const t = useArtifactSelectionToolbar({ getContainer: () => container, isBlocked: () => false })
    t.onSelectionChange()
    expect(t.visible.value).toBe(true)

    t.hide()

    expect(t.visible.value).toBe(false)
    expect(t.text.value).toBe('')
    expect(t.rect.value).toBeNull()
  })

  it('hides when there is no container (artifact closed)', () => {
    stubSelection(document.createElement('div'), { text: 'x' })
    const t = useArtifactSelectionToolbar({ getContainer: () => null, isBlocked: () => false })

    t.onSelectionChange()

    expect(t.visible.value).toBe(false)
  })
})
