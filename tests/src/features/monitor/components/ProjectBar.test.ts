import { mountWithI18n as mount } from '../../../helpers/i18n'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProjectBar from '@/features/monitor/components/ProjectBar.vue'
import { removeProject } from '../../../../../src/features/monitor/scripts/monitorApi'

vi.mock('@/features/monitor/scripts/monitorApi', () => ({
  addProject: vi.fn(async () => ({ project: { id: 'new-1', name: 'New' } })),
  removeProject: vi.fn(async () => ({ removed: true })),
}))

const projects = [
  { id: 'p-default', name: 'Default project', default: true },
  { id: 'p-other', name: 'Other project', default: false },
]

const projectsTriple = [
  { id: 'p-a', name: 'Project A', default: true },
  { id: 'p-b', name: 'Project B', default: false },
  { id: 'p-c', name: 'Project C', default: false },
]

// `.project-select-menu` được Teleport ra `document.body`, ngoài cây DOM gốc
// của wrapper — `wrapper.find`/`findAll` không thấy nó, phải query thẳng body.
function menuEl(): HTMLElement | null {
  return document.body.querySelector('.project-select-menu')
}

function menuItems() {
  return new DOMWrapper(document.body).findAll('.project-select-menu .project-item')
}

function mockTriggerRect(
  w: ReturnType<typeof mount>,
  rect: { top: number; bottom: number; left?: number; width?: number },
) {
  const el = w.get('.project-select-trigger').element as HTMLElement
  const left = rect.left ?? 20
  const width = rect.width ?? 140
  ;(el as any).getBoundingClientRect = () => ({
    top: rect.top,
    bottom: rect.bottom,
    left,
    right: left + width,
    width,
    height: rect.bottom - rect.top,
  })
  return el
}

function stubViewportHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

async function openSelectMenu(w: ReturnType<typeof mount>) {
  await w.find('.project-select-trigger').trigger('click')
}

// `updateMenuPosition` khi resize/scroll được throttle qua requestAnimationFrame
// (ProjectBar.vue) — đợi một nhịp thật để rAF chạy xong trước khi assert.
async function waitForRaf() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

let activeWrapper: ReturnType<typeof mount> | null = null

function mountBar(props: Record<string, any>) {
  activeWrapper = mount(ProjectBar, { props, attachTo: document.body })
  return activeWrapper
}

afterEach(() => {
  activeWrapper?.unmount()
  activeWrapper = null
  vi.mocked(removeProject).mockClear()
  vi.stubGlobal('confirm', undefined as any)
  stubViewportHeight(768)
  document.body.innerHTML = ''
})

describe('ProjectBar — dropdown không bị che, không bị cắt chiều cao (T242f6cc3)', () => {
  it('TC01 — mở dropdown khi đủ chỗ phía dưới: hiển thị đủ, không bị ancestor overflow cắt', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    mockTriggerRect(w, { top: 100, bottom: 132 })

    await openSelectMenu(w)

    const el = menuEl()
    expect(el).not.toBeNull()
    // Teleport ra thẳng body — không còn nằm trong bất kỳ ancestor overflow:hidden nào.
    expect(el!.parentElement).toBe(document.body)
    expect(el!.style.top).toBe('134px')
    expect(el!.style.bottom).toBe('auto')
    expect(el!.style.maxHeight).toBe('220px')
    expect(menuItems()).toHaveLength(projects.length)
  })

  it('TC02 — mở lại dropdown sau nhiều lần đổi qua lại repo vẫn đủ chiều cao', async () => {
    const w = mountBar({ projects: projectsTriple, defaultId: 'p-a', selectedId: 'p-a' })
    mockTriggerRect(w, { top: 100, bottom: 132 })

    await openSelectMenu(w)
    expect(menuEl()!.style.maxHeight).toBe('220px')
    expect(menuItems()).toHaveLength(3)

    // Chọn repo B → dropdown đóng lại theo hành vi hiện có.
    await menuItems()[1].find('.project-pick').trigger('click')
    expect(w.emitted('select')?.at(-1)).toEqual(['p-b'])
    expect(menuEl()).toBeNull()
    await w.setProps({ selectedId: 'p-b' })

    // Mở lại lần 2 — không được cắt ngắn hơn lần đầu.
    await openSelectMenu(w)
    expect(menuEl()!.style.maxHeight).toBe('220px')
    expect(menuItems()).toHaveLength(3)
    expect(menuItems()[1].attributes('aria-selected')).toBe('true')

    await menuItems()[2].find('.project-pick').trigger('click')
    expect(w.emitted('select')?.at(-1)).toEqual(['p-c'])
    await w.setProps({ selectedId: 'p-c' })

    // Mở lại lần 3 — vẫn đủ chiều cao, không bị ảnh hưởng bởi lịch sử mở/chọn trước đó.
    await openSelectMenu(w)
    expect(menuEl()!.style.maxHeight).toBe('220px')
    expect(menuItems()).toHaveLength(3)
    expect(menuItems()[2].attributes('aria-selected')).toBe('true')
  })

  it('TC03 — trigger gần mép dưới viewport, không đủ chỗ mở xuống: flip lên trên, không bị cắt', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    // innerHeight mặc định 768; trigger đặt gần đáy (bottom=730) → spaceBelow=28 (<80).
    mockTriggerRect(w, { top: 700, bottom: 730 })

    await openSelectMenu(w)

    const el = menuEl()!
    expect(el.style.bottom).toBe('70px')
    expect(el.style.top).toBe('auto')
    expect(el.style.maxHeight).toBe('220px')
    expect(menuItems()).toHaveLength(projects.length)
  })

  it('TC04 — viewport rất thấp (~200px): menu vẫn hiển thị với chiều cao tối thiểu, không co về 0/biến mất', async () => {
    stubViewportHeight(200)
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    // Cả trên (spaceAbove=80) lẫn dưới (spaceBelow=75) trigger đều chật.
    mockTriggerRect(w, { top: 90, bottom: 115 })

    await openSelectMenu(w)

    const el = menuEl()!
    expect(el.style.maxHeight).toBe('80px')
    expect(Number.parseFloat(el.style.maxHeight)).toBeGreaterThan(0)
    expect(menuItems()).toHaveLength(projects.length)
  })

  it('TC05 (quan trọng) — chọn/xoá repo trong menu đã teleport vẫn hoạt động, không bị onClickOutside chặn', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    mockTriggerRect(w, { top: 100, bottom: 132 })

    await openSelectMenu(w)
    await menuItems()[1].find('.project-pick').trigger('click')

    expect(w.emitted('select')?.at(-1)).toEqual(['p-other'])
    // Dropdown phải đóng lại đúng sau khi chọn — không bị onClickOutside đua/chặn.
    expect(menuEl()).toBeNull()

    await w.setProps({ selectedId: 'p-other' })
    await openSelectMenu(w)
    await menuItems()[0].find('.project-remove').trigger('click')
    await flushPromises()

    expect(removeProject).toHaveBeenCalledWith('p-default')
    expect(w.emitted('changed')).toBeTruthy()
  })

  it('TC06 — resize cửa sổ trong lúc menu đang mở tự tính lại vị trí, không lỗi runtime', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    const el = mockTriggerRect(w, { top: 100, bottom: 132 })
    await openSelectMenu(w)
    expect(menuEl()!.style.top).toBe('134px')

    ;(el as any).getBoundingClientRect = () => ({
      top: 300,
      bottom: 332,
      left: 20,
      right: 160,
      width: 140,
      height: 32,
    })
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow()
    await waitForRaf()

    expect(menuEl()!.style.top).toBe('334px')
  })

  it('TC07 — resize trong lúc menu đóng không tính lại; mở lại sau đó dùng đúng kích thước hiện tại', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    const el = mockTriggerRect(w, { top: 100, bottom: 132 })
    await openSelectMenu(w)
    expect(menuEl()!.style.top).toBe('134px')

    await w.find('.project-select-trigger').trigger('click') // đóng lại
    expect(menuEl()).toBeNull()

    ;(el as any).getBoundingClientRect = () => ({
      top: 300,
      bottom: 332,
      left: 20,
      right: 160,
      width: 140,
      height: 32,
    })
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow()
    await waitForRaf()
    expect(menuEl()).toBeNull() // vẫn đóng, không tự bật lại / không lỗi

    await openSelectMenu(w)
    // Mở lại phải dùng rect MỚI nhất tại thời điểm mở, không dùng lại vị trí cũ trước resize.
    expect(menuEl()!.style.top).toBe('334px')
  })

  it('TC08 — unmount trong lúc menu đang mở: không lỗi, không sót phần tử, không còn listener sống', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    const el = mockTriggerRect(w, { top: 100, bottom: 132 })
    const rectSpy = vi.fn(() => ({
      top: 100,
      bottom: 132,
      left: 20,
      right: 160,
      width: 140,
      height: 32,
    }))
    ;(el as any).getBoundingClientRect = rectSpy

    await openSelectMenu(w)
    expect(menuEl()).not.toBeNull()
    const callsAtOpen = rectSpy.mock.calls.length

    expect(() => w.unmount()).not.toThrow()
    activeWrapper = null // đã tự unmount, tránh afterEach unmount lần hai

    expect(menuEl()).toBeNull() // Teleport dọn sạch node đã chèn vào body khi unmount

    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow()
    expect(() => window.dispatchEvent(new Event('scroll'))).not.toThrow()
    await waitForRaf()
    // Không còn listener sống thì rect không được gọi thêm sau khi đã unmount.
    expect(rectSpy.mock.calls.length).toBe(callsAtOpen)
  })
})

describe('ProjectBar — remove default project (mục 2)', () => {
  it('renders a remove button for the default project too', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    await openSelectMenu(w)
    const items = menuItems()
    expect(items).toHaveLength(2)
    expect(items[0].find('.project-remove').exists()).toBe(true)
    expect(items[1].find('.project-remove').exists()).toBe(true)
  })

  it('shows browse button in the add form', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: null })
    await w.find('.project-add-btn').trigger('click')
    expect(w.find('.project-browse-btn').exists()).toBe(true)
  })

  it('clicking remove on the default project calls removeProject (no longer blocked)', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    await openSelectMenu(w)

    await menuItems()[0].find('.project-remove').trigger('click')
    await flushPromises()

    expect(removeProject).toHaveBeenCalledWith('p-default')
    expect(w.emitted('changed')).toBeTruthy()
  })

  it('shows a distinct confirm message warning about the default promotion', async () => {
    const confirmSpy = vi.fn((_message?: string) => false)
    vi.stubGlobal('confirm', confirmSpy)
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })
    await openSelectMenu(w)

    await menuItems()[0].find('.project-remove').trigger('click')

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(String(confirmSpy.mock.calls[0][0])).toContain('mặc định')
    expect(removeProject).not.toHaveBeenCalled()
  })

  it('cancelling the confirm on a non-default project does not call removeProject', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-other' })
    await openSelectMenu(w)

    await menuItems()[1].find('.project-remove').trigger('click')

    expect(removeProject).not.toHaveBeenCalled()
  })

  it('nav buttons cycle project selection', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: 'p-default' })

    await w.findAll('.project-nav-btn')[1].trigger('click')
    expect(w.emitted('select')?.at(-1)).toEqual(['p-other'])

    await w.setProps({ selectedId: 'p-other' })
    await w.findAll('.project-nav-btn')[0].trigger('click')
    expect(w.emitted('select')?.at(-1)).toEqual(['p-default'])
  })

  it('keeps create/clone forms compact (reduced padding)', async () => {
    const w = mountBar({ projects, defaultId: 'p-default', selectedId: null })
    await w.find('.project-clone-btn').trigger('click')
    const form = w.find('.project-add-form[data-form="git"]')
    expect(form.exists()).toBe(true)
    expect(form.classes()).toContain('project-add-form')
  })
})
