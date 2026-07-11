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
 * Best-effort line range for a selection: exact when it's fully inside one
 * block and the plain selected text can be found verbatim in that block's
 * raw markdown source (the common case — plain prose, no emphasis/links
 * inside the selection); falls back to the containing block's own full line
 * range otherwise (rendering strips markdown syntax from visible/selectable
 * text, so an exact character offset isn't always recoverable). A selection
 * spanning multiple blocks always uses the coarser first-to-last-block range.
 */
function computeSelectionLines(range: Range, text: string, blocks: BlockLineRange[]): SelectionLines | null {
  const startIdx = findBlockIndex(range.startContainer)
  const endIdx = findBlockIndex(range.endContainer)
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
    lines.value = blocks.length ? computeSelectionLines(range, t, blocks) : null
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
