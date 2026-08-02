import { ref } from 'vue'

// Drives the floating "selection toolbar" in ArtifactPanel: tracks the current
// text selection inside the artifact viewer and exposes just enough state
// (visible / text / rect) for the component to render a Teleported toolbar
// near the selection. Kept as a composable, separate from window event wiring
// in the caller, so the selection→toolbar logic is unit-testable without a
// real browser selection (jsdom's `Selection` API is limited).

export interface SelectionRect {
  top: number
  left: number
  width: number
  height: number
}

export interface SelectionLines {
  start: number
  end: number
}

/** Per-block raw-source metadata, indexed to match each block's rendered
 * `data-block-index` attribute — see ArtifactPanel.vue's `blockLineRanges`. */
export interface BlockLineRange {
  startLine: number
  endLine: number
  source: string
}

export interface UseArtifactSelectionToolbarOptions {
  // Element the selection must be inside to count (the markdown viewer root).
  getContainer: () => HTMLElement | null
  // True while editing a section, or when no artifact is open — selection
  // toolbar never shows in either case.
  isBlocked: () => boolean
  // Optional: per-block line-range metadata used to compute `lines` below.
  // Omit (or return []) to skip line-range computation entirely.
  getBlockRanges?: () => BlockLineRange[]
}

/** Walk up from a selection endpoint to the block element carrying
 * `data-block-index` (rendered once per markdown block in both Block and
 * Full view modes), so a selection can be traced back to a raw-source range
 * even though it was made against rendered (transformed) HTML. */
function findBlockIndex(node: Node | null): number | null {
  const el: Element | null = node instanceof Element ? node : node?.parentElement ?? null
  const found = el?.closest('[data-block-index]')
  if (!found) return null
  const idx = Number(found.getAttribute('data-block-index'))
  return Number.isFinite(idx) ? idx : null
}

/**
 * Fallback for when a range endpoint's container isn't inside any single
 * block element — this is real, observed behavior (not just a hypothetical):
 * browsers normalize a Range's start/end container to a shared ancestor
 * rather than a specific descendant whenever the endpoint lands "between"
 * children rather than inside one (e.g. Ctrl+A "select all" over the whole
 * viewer, or dragging from just above the first block's text to just below
 * the last one). When that ancestor sits *above* every `[data-block-index]`
 * element (e.g. the viewer root itself), `findBlockIndex`'s `closest()` walk
 * silently comes up empty even though the selection clearly overlaps real
 * blocks. Recover by scanning every block element under `root` and keeping
 * the ones the range actually intersects.
 */
function findBlockIndicesInRange(range: Range, root: HTMLElement): number[] {
  if (typeof range.intersectsNode !== 'function') return []
  const indices: number[] = []
  root.querySelectorAll('[data-block-index]').forEach((el) => {
    if (!range.intersectsNode(el)) return
    const idx = Number(el.getAttribute('data-block-index'))
    if (Number.isFinite(idx)) indices.push(idx)
  })
  return indices
}

/**
 * Best-effort line range for a selection: exact when it's fully inside one
 * block and the plain selected text can be found verbatim in that block's
 * raw markdown source (the common case — plain prose, no emphasis/links
 * inside the selection); falls back to the containing block's own full line
 * range otherwise (rendering strips markdown syntax from visible/selectable
 * text, so an exact character offset isn't always recoverable). A selection
 * spanning multiple blocks always uses the coarser first-to-last-block range.
 */
function computeSelectionLines(
  range: Range,
  text: string,
  blocks: BlockLineRange[],
  root: HTMLElement,
): SelectionLines | null {
  let startIdx = findBlockIndex(range.startContainer)
  let endIdx = findBlockIndex(range.endContainer)
  if (startIdx == null || endIdx == null) {
    const found = findBlockIndicesInRange(range, root)
    if (found.length) {
      startIdx = Math.min(...found)
      endIdx = Math.max(...found)
    }
  }
  if (startIdx == null || endIdx == null || !blocks[startIdx] || !blocks[endIdx]) return null

  if (startIdx === endIdx) {
    const block = blocks[startIdx]
    const offset = block.source.indexOf(text)
    if (offset >= 0) {
      const start = block.startLine + block.source.slice(0, offset).split('\n').length - 1
      return { start, end: start + text.split('\n').length - 1 }
    }
    return { start: block.startLine, end: block.endLine }
  }

  const lo = Math.min(startIdx, endIdx)
  const hi = Math.max(startIdx, endIdx)
  return { start: blocks[lo].startLine, end: blocks[hi].endLine }
}

export function useArtifactSelectionToolbar(opts: UseArtifactSelectionToolbarOptions) {
  const visible = ref(false)
  const text = ref('')
  const rect = ref<SelectionRect | null>(null)
  const lines = ref<SelectionLines | null>(null)

  function hide(): void {
    visible.value = false
    text.value = ''
    rect.value = null
    lines.value = null
  }

  function selectionInside(container: HTMLElement, range: Range): boolean {
    return container.contains(range.commonAncestorContainer)
  }

  /** Re-evaluate `window.getSelection()` and show/hide the toolbar accordingly. */
  function onSelectionChange(): void {
    if (opts.isBlocked()) {
      hide()
      return
    }
    const container = opts.getContainer()
    if (!container) {
      hide()
      return
    }
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      hide()
      return
    }
    const t = sel.toString().trim()
    if (!t) {
      hide()
      return
    }
    const range = sel.getRangeAt(0)
    if (!selectionInside(container, range)) {
      hide()
      return
    }
    const r = range.getBoundingClientRect()
    text.value = t
    rect.value = { top: r.top, left: r.left, width: r.width, height: r.height }
    const blocks = opts.getBlockRanges?.() ?? []
    lines.value = blocks.length ? computeSelectionLines(range, t, blocks, container) : null
    visible.value = true
  }

  function attach(): void {
    if (typeof document === 'undefined') return
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mouseup', onSelectionChange)
  }

  function detach(): void {
    if (typeof document === 'undefined') return
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('mouseup', onSelectionChange)
  }

  return { visible, text, rect, lines, hide, onSelectionChange, attach, detach }
}
