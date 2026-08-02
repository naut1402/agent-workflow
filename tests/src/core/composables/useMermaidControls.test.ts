import { describe, expect, it, vi } from 'vitest'
import { attachMermaidControls } from '../../../../src/core/composables/useMermaidControls'

function makeRoot(): HTMLElement {
  const root = document.createElement('div')
  const mermaid = document.createElement('div')
  mermaid.className = 'mermaid'
  mermaid.textContent = 'graph TD; A-->B;'
  root.appendChild(mermaid)
  document.body.appendChild(root)
  return root
}

describe('attachMermaidControls', () => {
  it('wraps each .mermaid node with a toolbar', () => {
    const root = makeRoot()
    attachMermaidControls(root, { onToggleFullscreen: vi.fn() })

    expect(root.querySelectorAll('.mermaid-wrap')).toHaveLength(1)
    expect(root.querySelectorAll('.mermaid-toolbar')).toHaveLength(1)
    expect(root.querySelector('.mermaid')?.getAttribute('data-mermaid-controls')).toBe('1')
  })

  it('is idempotent — calling twice does not create a second wrap/toolbar', () => {
    const root = makeRoot()
    attachMermaidControls(root, { onToggleFullscreen: vi.fn() })
    attachMermaidControls(root, { onToggleFullscreen: vi.fn() })

    expect(root.querySelectorAll('.mermaid-wrap')).toHaveLength(1)
    expect(root.querySelectorAll('.mermaid-toolbar')).toHaveLength(1)
  })

  it('zoom-reset button uses an icon (not the wrapping «100%» label)', () => {
    const root = makeRoot()
    attachMermaidControls(root, { onToggleFullscreen: vi.fn() })
    const reset = root.querySelector<HTMLButtonElement>('[data-act="zoom-reset"]')!
    expect(reset.textContent?.trim()).toBe('↺')
    expect(reset.textContent).not.toContain('100%')
  })

  it('zoom-in / zoom-out / zoom-reset update the mermaid node transform', () => {
    const root = makeRoot()
    attachMermaidControls(root, { onToggleFullscreen: vi.fn() })
    const node = root.querySelector<HTMLElement>('.mermaid')!

    root.querySelector<HTMLButtonElement>('[data-act="zoom-in"]')!.click()
    expect(node.style.transform).toBe('scale(1.25)')

    root.querySelector<HTMLButtonElement>('[data-act="zoom-in"]')!.click()
    expect(node.style.transform).toBe('scale(1.5)')

    root.querySelector<HTMLButtonElement>('[data-act="zoom-out"]')!.click()
    expect(node.style.transform).toBe('scale(1.25)')

    root.querySelector<HTMLButtonElement>('[data-act="zoom-reset"]')!.click()
    expect(node.style.transform).toBe('scale(1)')
  })

  it('clamps zoom between 0.5 and 3', () => {
    const root = makeRoot()
    attachMermaidControls(root, { onToggleFullscreen: vi.fn() })
    const node = root.querySelector<HTMLElement>('.mermaid')!
    const zoomOut = root.querySelector<HTMLButtonElement>('[data-act="zoom-out"]')!
    const zoomIn = root.querySelector<HTMLButtonElement>('[data-act="zoom-in"]')!

    for (let i = 0; i < 10; i++) zoomOut.click()
    expect(node.style.transform).toBe('scale(0.5)')

    for (let i = 0; i < 20; i++) zoomIn.click()
    expect(node.style.transform).toBe('scale(3)')
  })

  it('calls onToggleFullscreen with the wrap element when the fullscreen button is clicked', () => {
    const root = makeRoot()
    const onToggleFullscreen = vi.fn()
    attachMermaidControls(root, { onToggleFullscreen })

    const wrap = root.querySelector<HTMLElement>('.mermaid-wrap')!
    const btn = root.querySelector<HTMLButtonElement>('[data-act="fullscreen"]')
    expect(btn).toBeTruthy()
    btn!.click()

    expect(onToggleFullscreen).toHaveBeenCalledWith(wrap)
  })

  it('does nothing when rootEl is null/undefined', () => {
    expect(() => attachMermaidControls(null, { onToggleFullscreen: vi.fn() })).not.toThrow()
    expect(() => attachMermaidControls(undefined, { onToggleFullscreen: vi.fn() })).not.toThrow()
  })
})
