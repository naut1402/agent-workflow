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

export interface UseArtifactSelectionToolbarOptions {
  // Element the selection must be inside to count (the markdown viewer root).
  getContainer: () => HTMLElement | null
  // True while editing a section, or when no artifact is open — selection
  // toolbar never shows in either case.
  isBlocked: () => boolean
}

export function useArtifactSelectionToolbar(opts: UseArtifactSelectionToolbarOptions) {
  const visible = ref(false)
  const text = ref('')
  const rect = ref<SelectionRect | null>(null)

  function hide(): void {
    visible.value = false
    text.value = ''
    rect.value = null
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

  return { visible, text, rect, hide, onSelectionChange, attach, detach }
}
