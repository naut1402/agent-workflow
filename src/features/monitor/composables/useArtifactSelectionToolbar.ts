import { ref } from 'vue'

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

/** Per-block raw-source line range, indexed like the rendered `data-block-index` attribute. */
export interface BlockLineRange {
  startLine: number
  endLine: number
  source: string
}

export interface UseArtifactSelectionToolbarOptions {
  getContainer: () => HTMLElement | null
  isBlocked: () => boolean
  getBlockRanges?: () => BlockLineRange[]
}

function findBlockIndex(node: Node | null): number | null {
  const el: Element | null = node instanceof Element ? node : node?.parentElement ?? null
  const found = el?.closest('[data-block-index]')
  if (!found) return null
  const idx = Number(found.getAttribute('data-block-index'))
  return Number.isFinite(idx) ? idx : null
}

// xem docs/architecture/code/monitor.md §23
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
