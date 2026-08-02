import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import MonitorLayout from '@/features/monitor/components/MonitorLayout.vue'
import { STORAGE_KEY, useAppSettings } from '@/core/composables/useAppSettings'

const SUB_SIDEBAR_KEY = 'dev-dashboard-monitor-subsidebar-collapsed'

const tasks = [
  {
    task_id: 'B4488',
    current_phase: 'designer',
    hitl_pending: null,
    has_qa: false,
    state_ok: true,
    artifacts: { 'investigate.md': { exists: true } },
  },
]

function seedAppSettings(patch: Record<string, unknown> = {}) {
  localStorage.clear()
  if (Object.keys(patch).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(patch))
  const { load } = useAppSettings()
  load()
}

function dispatchOutsideClick(target: Element) {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

// `onClickOutside` (@vueuse/core) debounces its window "click" listener via a
// real `setTimeout(0)` macrotask (not a microtask) — awaiting `nextTick()`
// alone isn't enough to clear that flag between two synthetic clicks.
function flushMacrotask() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

afterEach(() => {
  localStorage.clear()
  const { load } = useAppSettings()
  load()
  document.body.innerHTML = ''
})

describe('MonitorLayout — sub-sidebar collapse (mục 5)', () => {
  it('toggling the collapse button flips the class and persists to localStorage', async () => {
    const w = mount(MonitorLayout, { props: { tasks } })
    expect(w.find('.monitor-sub-sidebar').classes()).not.toContain('monitor-sub-sidebar--collapsed')

    await w.find('.monitor-sub-sidebar-collapse-btn').trigger('click')

    expect(w.find('.monitor-sub-sidebar').classes()).toContain('monitor-sub-sidebar--collapsed')
    expect(w.find('.monitor-layout').classes()).toContain('monitor-layout--sub-collapsed')
    expect(localStorage.getItem(SUB_SIDEBAR_KEY)).toBe('1')
  })

  it('reads the persisted collapsed state on mount', async () => {
    localStorage.setItem(SUB_SIDEBAR_KEY, '1')
    const w = mount(MonitorLayout, { props: { tasks } })
    await w.vm.$nextTick()
    expect(w.find('.monitor-sub-sidebar').classes()).toContain('monitor-sub-sidebar--collapsed')
  })
})

describe('MonitorLayout — auto-collapse task file-list on outside click (mục 7)', () => {
  it('does nothing when the setting is off (default)', async () => {
    seedAppSettings()
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.find('.file-list').exists()).toBe(true)
    await flushMacrotask()

    dispatchOutsideClick(outside)
    await w.vm.$nextTick()

    expect(w.find('.file-list').exists()).toBe(true)
    w.unmount()
  })

  it('collapses the task list when the setting is on and the click lands outside the sub-sidebar', async () => {
    seedAppSettings({ collapseTaskExpandOnOutside: true })
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.find('.file-list').exists()).toBe(true)
    await flushMacrotask()

    dispatchOutsideClick(outside)
    await w.vm.$nextTick()

    expect(w.find('.file-list').exists()).toBe(false)
    w.unmount()
  })

  it('does not collapse when the click lands inside the sub-sidebar', async () => {
    seedAppSettings({ collapseTaskExpandOnOutside: true })

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.find('.file-list').exists()).toBe(true)
    await flushMacrotask()

    dispatchOutsideClick(w.find('.monitor-sub-sidebar').element)
    await w.vm.$nextTick()

    expect(w.find('.file-list').exists()).toBe(true)
    w.unmount()
  })
})

describe('MonitorLayout — auto-collapse sub-sidebar on outside click', () => {
  it('does not collapse the sub-sidebar when the setting is off', async () => {
    seedAppSettings()
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    expect(w.find('.monitor-sub-sidebar').classes()).not.toContain('monitor-sub-sidebar--collapsed')
    await flushMacrotask()

    dispatchOutsideClick(outside)
    await w.vm.$nextTick()

    expect(w.find('.monitor-sub-sidebar').classes()).not.toContain('monitor-sub-sidebar--collapsed')
    w.unmount()
  })

  it('collapses the sub-sidebar when the setting is on and click is outside', async () => {
    seedAppSettings({ collapseMonitorSubSidebarOnOutside: true })
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await flushMacrotask()

    dispatchOutsideClick(outside)
    await w.vm.$nextTick()

    expect(w.find('.monitor-sub-sidebar').classes()).toContain('monitor-sub-sidebar--collapsed')
    expect(localStorage.getItem(SUB_SIDEBAR_KEY)).toBe('1')
    w.unmount()
  })

  it('does not collapse when the click lands inside a teleported .modal-backdrop', async () => {
    seedAppSettings({ collapseMonitorSubSidebarOnOutside: true })
    const modal = document.createElement('div')
    modal.className = 'modal-backdrop'
    const item = document.createElement('button')
    item.className = 'folder-picker-item'
    modal.appendChild(item)
    document.body.appendChild(modal)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await flushMacrotask()

    dispatchOutsideClick(item)
    await w.vm.$nextTick()

    expect(w.find('.monitor-sub-sidebar').classes()).not.toContain('monitor-sub-sidebar--collapsed')
    expect(w.find('.project-bar').exists()).toBe(true)
    w.unmount()
  })
})
