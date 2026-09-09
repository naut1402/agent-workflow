import { afterEach, describe, expect, it, vi } from 'vitest'
import { useArtifactSelectionToolbar } from '@/features/monitor/composables/useArtifactSelectionToolbar'

// jsdom's Selection API doesn't reflect real DOM selections made by test
// helpers, so we stub `window.getSelection()` directly and drive
// `onSelectionChange()` by hand — the same shape the composable would see
// when `selectionchange`/`mouseup` fires in a real browser.

function stubSelection(
  container: HTMLElement,
  opts: {
    text: string
    collapsed?: boolean
    insideContainer?: boolean
    startContainer?: Node
    endContainer?: Node
  } | null,
) {
  const fake = opts
    ? ({
        rangeCount: 1,
        isCollapsed: opts.collapsed ?? false,
        toString: () => opts.text,
        getRangeAt: () => ({
          commonAncestorContainer: opts.insideContainer === false ? document.createElement('div') : container,
          startContainer: opts.startContainer ?? container,
          endContainer: opts.endContainer ?? container,
          getBoundingClientRect: () => ({ top: 10, left: 20, width: 100, height: 16 }),
        }),
      } as unknown as Selection)
    : null
  return vi.spyOn(window, 'getSelection').mockReturnValue(fake)
}

/** A block wrapper carrying `data-block-index`, matching what ArtifactPanel
 * renders around each markdown block (see computeSelectionLines). */
function blockEl(index: number, text: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-block-index', String(index))
  el.textContent = text
  return el
}

/** Stub `window.getSelection()` to return a *real* `Range` (built via
 * `document.createRange()`), rather than the plain-object fake `getRangeAt()`
 * used elsewhere in this file. Needed for the "container is above any block"
 * regression test below, which relies on genuine `Range.intersectsNode()`
 * behavior that a hand-rolled stub can't reproduce. */
function stubRealSelection(text: string, range: Range) {
  const fake = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => range,
  } as unknown as Selection
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

  it('hide() clears visible/text/rect/lines', () => {
    const container = document.createElement('div')
    stubSelection(container, { text: 'x' })
    const t = useArtifactSelectionToolbar({ getContainer: () => container, isBlocked: () => false })
    t.onSelectionChange()
    expect(t.visible.value).toBe(true)

    t.hide()

    expect(t.visible.value).toBe(false)
    expect(t.text.value).toBe('')
    expect(t.rect.value).toBeNull()
    expect(t.lines.value).toBeNull()
  })

  describe('line range (selection → raw-source lines)', () => {
    it('is null when no block metadata is supplied', () => {
      const container = document.createElement('div')
      const block = blockEl(0, 'hello world')
      container.appendChild(block)
      stubSelection(container, { text: 'hello world', startContainer: block, endContainer: block })
      const t = useArtifactSelectionToolbar({ getContainer: () => container, isBlocked: () => false })

      t.onSelectionChange()

      expect(t.lines.value).toBeNull()
    })

    it('computes a precise range when the selected text is found in the containing block source', () => {
      const container = document.createElement('div')
      const block = blockEl(0, 'hello world')
      container.appendChild(block)
      stubSelection(container, { text: 'hello world', startContainer: block, endContainer: block })
      const t = useArtifactSelectionToolbar({
        getContainer: () => container,
        isBlocked: () => false,
        getBlockRanges: () => [{ startLine: 10, endLine: 12, source: 'para one\nhello world\npara three' }],
      })

      t.onSelectionChange()

      // "para one\n" is 1 line before the match → block startLine (10) + 1 = 11.
      expect(t.lines.value).toEqual({ start: 11, end: 11 })
    })

    it('falls back to the whole block range when the selected text is not found verbatim', () => {
      const container = document.createElement('div')
      const block = blockEl(0, 'some rendered text')
      container.appendChild(block)
      stubSelection(container, { text: 'some rendered text', startContainer: block, endContainer: block })
      const t = useArtifactSelectionToolbar({
        getContainer: () => container,
        isBlocked: () => false,
        getBlockRanges: () => [{ startLine: 4, endLine: 9, source: 'raw markdown differs from rendered text' }],
      })

      t.onSelectionChange()

      expect(t.lines.value).toEqual({ start: 4, end: 9 })
    })

    it('spans first-block-start to last-block-end when the selection crosses blocks', () => {
      const container = document.createElement('div')
      const startBlock = blockEl(0, 'end of first block')
      const endBlock = blockEl(2, 'start of third block')
      container.append(startBlock, endBlock)
      stubSelection(container, {
        text: 'end of first block ... start of third block',
        startContainer: startBlock,
        endContainer: endBlock,
      })
      const t = useArtifactSelectionToolbar({
        getContainer: () => container,
        isBlocked: () => false,
        getBlockRanges: () => [
          { startLine: 1, endLine: 3, source: 'block 0' },
          { startLine: 4, endLine: 6, source: 'block 1' },
          { startLine: 7, endLine: 9, source: 'block 2' },
        ],
      })

      t.onSelectionChange()

      expect(t.lines.value).toEqual({ start: 1, end: 9 })
    })

    // Regression: real browsers don't always set a Range's start/end
    // container to a node inside the nearest block — they normalize it to a
    // shared ancestor whenever an endpoint falls "between" children rather
    // than inside one (this is exactly what happens for Ctrl+A "select all",
    // or dragging from just above the first block's text to just below the
    // last). The container/offset-based stub above can't express that, so
    // this test drives `onSelectionChange` with a genuine `Range` built via
    // `document.createRange()` whose `startContainer`/`endContainer` is the
    // *viewer root itself* — reproducing the reported "selection lines don't
    // attach" bug. Before the `findBlockIndicesInRange` fallback, `closest()`
    // on the root container found no `[data-block-index]` ancestor (the root
    // has none, and walking further up finds nothing either), so
    // `computeSelectionLines` returned `null` silently.
    it('still resolves a line range when the range container sits above every block (e.g. select-all)', () => {
      const container = document.createElement('div')
      const block0 = blockEl(0, 'first block text')
      const block1 = blockEl(1, 'second block text')
      container.append(block0, block1)
      document.body.appendChild(container)

      const range = document.createRange()
      range.setStart(container, 0)
      range.setEnd(container, container.childNodes.length)
      // jsdom's real Range doesn't implement layout-dependent methods.
      ;(range as any).getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0 })
      stubRealSelection('first block text second block text', range)

      const t = useArtifactSelectionToolbar({
        getContainer: () => container,
        isBlocked: () => false,
        getBlockRanges: () => [
          { startLine: 1, endLine: 2, source: 'first block text' },
          { startLine: 3, endLine: 4, source: 'second block text' },
        ],
      })

      t.onSelectionChange()

      expect(t.visible.value).toBe(true)
      expect(t.lines.value).toEqual({ start: 1, end: 4 })

      container.remove()
    })

    // Same regression, but for a single-block "select all" — the fallback
    // must still find the one block, not silently drop the range entirely.
    it('resolves a single-block range when the container sits above that one block', () => {
      const container = document.createElement('div')
      const block0 = blockEl(0, 'only block text')
      container.append(block0)
      document.body.appendChild(container)

      const range = document.createRange()
      range.setStart(container, 0)
      range.setEnd(container, container.childNodes.length)
      ;(range as any).getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0 })
      stubRealSelection('only block text', range)

      const t = useArtifactSelectionToolbar({
        getContainer: () => container,
        isBlocked: () => false,
        getBlockRanges: () => [{ startLine: 5, endLine: 7, source: 'only block text' }],
      })

      t.onSelectionChange()

      // Single block, exact verbatim match within it → precise single line
      // (block starts at line 5, text is on the block's first line).
      expect(t.lines.value).toEqual({ start: 5, end: 5 })

      container.remove()
    })
  })

  it('hides when there is no container (artifact closed)', () => {
    stubSelection(document.createElement('div'), { text: 'x' })
    const t = useArtifactSelectionToolbar({ getContainer: () => null, isBlocked: () => false })

    t.onSelectionChange()

    expect(t.visible.value).toBe(false)
  })
})
