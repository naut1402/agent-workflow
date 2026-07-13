import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import {
  splitMarkdownSections,
  joinMarkdownSections,
  useInlineMarkdownEdit,
} from '../../../../src/features/monitor/composables/useInlineMarkdownEdit'

describe('splitMarkdownSections', () => {
  it('splits on H2 headings', () => {
    const source = '# Title\n\n## One\n\nA\n\n## Two\n\nB'
    expect(splitMarkdownSections(source)).toEqual([
      '# Title\n\n',
      '## One\n\nA\n\n',
      '## Two\n\nB',
    ])
  })

  it('returns empty for blank source', () => {
    expect(splitMarkdownSections('   ')).toEqual([])
  })
})

describe('joinMarkdownSections', () => {
  it('joins sections with blank line', () => {
    expect(joinMarkdownSections(['## A\n\nx', '## B\n\ny'])).toBe('## A\n\nx\n\n## B\n\ny')
  })
})

describe('useInlineMarkdownEdit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(initial = '## One\n\nA\n\n## Two\n\nB') {
    const content = ref(initial)
    const onSave = vi.fn(async (next: string) => {
      content.value = next
    })
    const api = useInlineMarkdownEdit({
      getContent: () => content.value,
      setContent: (v) => { content.value = v },
      onSave,
    })
    return { content, onSave, ...api }
  }

  it('startEdit loads draft for a block section', () => {
    const { startEdit, editingSection, sectionDraft } = setup()
    startEdit(1)
    expect(editingSection.value).toBe(1)
    expect(sectionDraft.value).toBe('## Two\n\nB')
  })

  it('onBlur without changes exits edit without saving', async () => {
    const { startEdit, onBlur, editingSection, onSave } = setup()
    startEdit('full')
    await onBlur()
    expect(onSave).not.toHaveBeenCalled()
    expect(editingSection.value).toBeNull()
  })

  it('onBlur saves merged content for a block section', async () => {
    const { startEdit, sectionDraft, onBlur, onSave, content } = setup()
    startEdit(1)
    sectionDraft.value = '## Two\n\nChanged'
    await onBlur()
    const saved = onSave.mock.calls[0][0] as string
    expect(saved).toContain('## Two\n\nChanged')
    expect(saved).toContain('## One')
    expect(content.value).toBe(saved)
  })

  it('shows saving then saved indicator after successful blur save', async () => {
    let resolveSave!: () => void
    const content = ref('hello')
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    const {
      startEdit,
      sectionDraft,
      onBlur,
      showSavingIndicator,
      showSavedIndicator,
    } = useInlineMarkdownEdit({
      getContent: () => content.value,
      setContent: (v) => { content.value = v },
      onSave,
    })

    startEdit('full')
    sectionDraft.value = 'updated'
    const blurPromise = onBlur()
    expect(showSavingIndicator('full')).toBe(true)
    expect(showSavedIndicator('full')).toBe(false)

    resolveSave()
    await blurPromise
    expect(showSavingIndicator('full')).toBe(false)
    expect(showSavedIndicator('full')).toBe(true)

    vi.advanceTimersByTime(2500)
    expect(showSavedIndicator('full')).toBe(false)
  })

  it('Escape cancels edit and clears saved indicator', () => {
    const { startEdit, onKeydown, cancelEdit, editingSection, savedSection } = setup()
    startEdit('full')
    onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(editingSection.value).toBeNull()

    startEdit('full')
    cancelEdit()
    expect(savedSection.value).toBeNull()
  })

  it('ignores click on links when starting edit', () => {
    const { startEdit, editingSection } = setup('## One\n\n[link](http://x)')
    const anchor = document.createElement('a')
    anchor.href = 'http://x'
    anchor.textContent = 'link'
    const event = { target: anchor } as unknown as MouseEvent
    startEdit('full', event)
    expect(editingSection.value).toBeNull()
  })

  it('ignores click inside Toast UI editor chrome when starting edit', () => {
    const { startEdit, editingSection } = setup()
    const ui = document.createElement('div')
    ui.className = 'toastui-editor-defaultUI'
    const inner = document.createElement('div')
    ui.appendChild(inner)
    document.body.appendChild(ui)
    const event = { target: inner } as unknown as MouseEvent
    startEdit('full', event)
    expect(editingSection.value).toBeNull()
    ui.remove()
  })

  it('startEdit focuses the bound edit target', async () => {
    const { nextTick } = await import('vue')
    const { startEdit, editTextarea } = setup('hello')
    const focus = vi.fn()
    editTextarea.value = { focus }
    startEdit('full')
    await nextTick()
    expect(focus).toHaveBeenCalled()
  })
})
