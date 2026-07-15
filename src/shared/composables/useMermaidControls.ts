// Thao tác DOM thuần để gắn control zoom + fullscreen cho các node `.mermaid`
// sau khi renderMermaid() vẽ xong. Cố ý KHÔNG chạm vào attribute mà
// renderMermaid() dựa vào (`data-mermaid-src`, `data-mermaid-theme`,
// `data-processed`) — chỉ bọc thêm phần tử xung quanh — để giữ nguyên cơ chế
// chống-flicker khi poll 1500ms (xem shared/markdown.ts).
export interface MermaidControlsOptions {
  onToggleFullscreen: (wrapEl: HTMLElement) => void
}

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled !== false
}

/** Bọc mỗi `.mermaid` chưa có control bằng toolbar zoom/fullscreen. Idempotent
 * — node đã có `data-mermaid-controls` sẽ bị bỏ qua ở lần gọi sau. */
export function attachMermaidControls(
  rootEl: HTMLElement | null | undefined,
  { onToggleFullscreen }: MermaidControlsOptions,
): void {
  if (!rootEl) return
  const nodes = rootEl.querySelectorAll<HTMLElement>('.mermaid')
  nodes.forEach((node) => {
    if (node.dataset.mermaidControls === '1') return
    node.dataset.mermaidControls = '1'
    node.style.transformOrigin = 'top center'
    node.dataset.zoom = '1'

    const parent = node.parentElement
    if (!parent) return

    const wrap = document.createElement('div')
    wrap.className = 'mermaid-wrap'
    parent.insertBefore(wrap, node)
    wrap.appendChild(node)

    const toolbar = document.createElement('div')
    toolbar.className = 'mermaid-toolbar'
    const fullscreenBtn = fullscreenSupported()
      ? '<button type="button" data-act="fullscreen">⛶</button>'
      : ''
    toolbar.innerHTML = `
      <button type="button" data-act="zoom-out">−</button>
      <button type="button" data-act="zoom-reset">100%</button>
      <button type="button" data-act="zoom-in">+</button>
      ${fullscreenBtn}`
    wrap.appendChild(toolbar)

    toolbar.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      const btn = target.closest<HTMLButtonElement>('button[data-act]')
      if (!btn) return
      const act = btn.dataset.act
      if (act === 'fullscreen') {
        onToggleFullscreen(wrap)
        return
      }
      let z = Number(node.dataset.zoom || '1')
      if (act === 'zoom-in') z = Math.min(ZOOM_MAX, z + ZOOM_STEP)
      else if (act === 'zoom-out') z = Math.max(ZOOM_MIN, z - ZOOM_STEP)
      else z = 1
      node.dataset.zoom = String(z)
      node.style.transform = `scale(${z})`
    })
  })
}
